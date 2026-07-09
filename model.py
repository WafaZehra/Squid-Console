import random
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.metrics import precision_recall_curve, roc_auc_score
from sklearn.preprocessing import StandardScaler

SEED = 42
MAX_CATEGORICAL_CARDINALITY = 20
SENSITIVITY_PERCENTILES = {"conservative": 99, "balanced": 95, "sensitive": 90}

def set_seed(seed: int = SEED) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

class TabularAutoencoder(nn.Module):
    def __init__(self, input_dim: int):
        super().__init__()
        h1 = int(np.clip(input_dim * 2, 16, 128))
        h2 = int(np.clip(input_dim, 8, 64))
        h2 = min(h2, max(h1 - 1, 4))
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, h1), nn.ReLU(),
            nn.Linear(h1, h2), nn.ReLU(),
        )
        self.decoder = nn.Sequential(
            nn.Linear(h2, h1), nn.ReLU(),
            nn.Linear(h1, input_dim),
        )
    def forward(self, x):
        return self.decoder(self.encoder(x))

def _read_csv(path: str, has_header: bool) -> pd.DataFrame:
    df = pd.read_csv(path, header=0 if has_header else None)
    if not has_header:
        df.columns = [f"column_{i + 1}" for i in range(df.shape[1])]
    df.columns = [str(c) for c in df.columns]
    return df

def preview_csv(path: str, has_header: bool = True) -> dict:
    df = _read_csv(path, has_header)
    columns = []
    for col in df.columns:
        series = df[col]
        is_numeric = pd.api.types.is_numeric_dtype(series)
        columns.append({
            "name": col,
            "dtype": "numeric" if is_numeric else "categorical",
            "unique_values": int(series.nunique(dropna=True)),
            "missing": int(series.isna().sum()),
            "sample": [str(v) for v in series.dropna().unique()[:5]],
        })
    return {
        "columns": columns,
        "row_count": int(len(df)),
        "preview_rows": df.head(8).fillna("").astype(str).values.tolist(),
    }

def _to_jsonable(value):
    if pd.isna(value):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    return value if isinstance(value, (int, float, str, bool)) else str(value)

def run_analysis(
    path: str,
    has_header: bool = True,
    label_column: str | None = None,
    exclude_columns: list[str] | None = None,
    sensitivity: str = "balanced",
    epochs: int = 120,
) -> dict:
    set_seed()
    exclude_columns = set(exclude_columns or [])
    df = _read_csv(path, has_header)
    notes: list[str] = []

    label_series = None
    if label_column and label_column in df.columns:
        label_series = df[label_column]

    feature_cols_raw = [
        c for c in df.columns if c != label_column and c not in exclude_columns
    ]
    if not feature_cols_raw:
        raise ValueError("No feature columns left after excluding the label/excluded columns.")

    work = df[feature_cols_raw].copy()

    #missing values
    missing_report = {}
    for col in work.columns:
        n_missing = int(work[col].isna().sum())
        if n_missing > 0:
            missing_report[col] = n_missing
            if pd.api.types.is_numeric_dtype(work[col]):
                work[col] = work[col].fillna(work[col].mean())
            else:
                mode = work[col].mode()
                work[col] = work[col].fillna(mode.iloc[0] if not mode.empty else "missing")
    if missing_report:
        notes.append(
            f"Filled missing values in {len(missing_report)} column(s) "
            "(mean for numeric, most common value for categorical)."
        )

    #numeric vs categorical handling
    numeric_cols = [c for c in work.columns if pd.api.types.is_numeric_dtype(work[c])]
    categorical_cols = [c for c in work.columns if c not in numeric_cols]
    dropped_high_card, encode_cols = [], []
    for c in categorical_cols:
        (dropped_high_card if work[c].nunique() > MAX_CATEGORICAL_CARDINALITY else encode_cols).append(c)
    if dropped_high_card:
        work = work.drop(columns=dropped_high_card)
        notes.append(
            f"Excluded {len(dropped_high_card)} high-cardinality text column(s) "
            f"automatically (too many unique values to encode): {', '.join(dropped_high_card)}."
        )
    if encode_cols:
        work = pd.get_dummies(work, columns=encode_cols, prefix=encode_cols)
        notes.append(f"One-hot encoded {len(encode_cols)} categorical column(s): {', '.join(encode_cols)}.")
    feature_names = list(work.columns)
    base_of = {}
    for col in feature_names:
        base_of[col] = next((c for c in encode_cols if col.startswith(c + "_")), col)
    X = work.values.astype(float)
    n_rows, n_features = X.shape
    if n_features == 0:
        raise ValueError("No usable feature columns were found in this file.")

    #supervised vs unsupervised mode
    mode = "unsupervised"
    y = None
    if label_series is not None:
        non_null = label_series.dropna()
        uniques = non_null.unique()
        if len(uniques) == 2:
            counts = non_null.value_counts()
            anomaly_value = counts.idxmin()
            normal_count, anomaly_count = counts.max(), counts.min()
            if anomaly_count >= 1 and normal_count >= 10:
                y = (label_series == anomaly_value).fillna(False).astype(int).values
                mode = "supervised"
                notes.append(
                    f"Using '{label_column}' as ground truth — treating "
                    f"'{anomaly_value}' as the anomaly class for evaluation only."
                )
            else:
                notes.append(
                    f"'{label_column}' is binary but too imbalanced to evaluate "
                    "reliably — running unsupervised instead."
                )
        else:
            notes.append(
                f"'{label_column}' has {len(uniques)} unique values, so it can't be used "
                "as a binary ground truth — running unsupervised instead."
            )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if mode == "supervised":
        normal_idx = np.where(y == 0)[0]
        rng = np.random.RandomState(SEED)
        rng.shuffle(normal_idx)
        split = max(1, int(len(normal_idx) * 0.8))
        X_train_raw = X[normal_idx[:split]]
    else:
        X_train_raw = X 

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_raw)
    X_all_scaled = scaler.transform(X)

    X_train_tensor = torch.FloatTensor(X_train_scaled).to(device)
    X_all_tensor = torch.FloatTensor(X_all_scaled).to(device)

    model = TabularAutoencoder(n_features).to(device)
    batch_size = max(4, min(32, len(X_train_tensor) // 4 or 4))
    loader = DataLoader(TensorDataset(X_train_tensor), batch_size=batch_size, shuffle=True)
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.005)

    loss_history = []
    model.train()
    for _ in range(epochs):
        epoch_loss = 0.0
        for (batch_x,) in loader:
            optimizer.zero_grad()
            out = model(batch_x)
            loss = criterion(out, batch_x)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item() * batch_x.size(0)
        loss_history.append(epoch_loss / len(X_train_tensor))

    model.eval()
    with torch.no_grad():
        recon = model(X_all_tensor)
        per_feature_sq_err = (X_all_tensor - recon).pow(2).cpu().numpy()
    errors = per_feature_sq_err.mean(axis=1)

    #threshold + evaluation
    metrics = None
    if mode == "supervised":
        precisions, recalls, thresholds = precision_recall_curve(y, errors)
        best_f1, best_t = 0.0, float(np.percentile(errors, 95))
        for p, r, t in zip(precisions[:-1], recalls[:-1], thresholds):
            if p + r > 0:
                f1 = 2 * p * r / (p + r)
                if f1 > best_f1:
                    best_f1, best_t = f1, t
        threshold, threshold_method = float(best_t), "optimal F1 (vs. ground truth)"
        preds = (errors > threshold).astype(int)
        tp = int(((preds == 1) & (y == 1)).sum())
        fp = int(((preds == 1) & (y == 0)).sum())
        tn = int(((preds == 0) & (y == 0)).sum())
        fn = int(((preds == 0) & (y == 1)).sum())
        metrics = {
            "auroc": float(roc_auc_score(y, errors)),
            "best_f1": float(best_f1),
            "precision": tp / (tp + fp) if (tp + fp) else 0.0,
            "recall": tp / (tp + fn) if (tp + fn) else 0.0,
            "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        }
    else:
        pct = SENSITIVITY_PERCENTILES.get(sensitivity, 95)
        threshold = float(np.percentile(errors, pct))
        threshold_method = f"top {100 - pct}% of reconstruction error"

    is_anomaly = errors > threshold

    #per-row breakdown
    feat_arr = np.array(feature_names)
    rows_out = []
    for i in range(n_rows):
        contrib = per_feature_sq_err[i]
        order = np.argsort(contrib)[::-1]
        top, seen = [], set()
        for j in order:
            base = base_of[feat_arr[j]]
            if base in seen:
                continue
            seen.add(base)
            top.append({
                "feature": base,
                "contribution": float(contrib[j]),
                "value": _to_jsonable(df.iloc[i][base]) if base in df.columns else None,
            })
            if len(top) >= 5:
                break
        rows_out.append({
            "index": int(i),
            "error": float(errors[i]),
            "is_anomaly": bool(is_anomaly[i]),
            "true_label": _to_jsonable(label_series.iloc[i]) if label_series is not None else None,
            "top_features": top,
        })

    #per-feature summary
    feature_summary = []
    for base in sorted(set(base_of.values())):
        if base in numeric_cols:
            col_vals = pd.to_numeric(df[base], errors="coerce").values
            normal_vals = col_vals[~is_anomaly]
            anomaly_vals = col_vals[is_anomaly]
            feature_summary.append({
                "feature": base,
                "type": "numeric",
                "normal_mean": float(np.nanmean(normal_vals)) if len(normal_vals) else None,
                "normal_std": float(np.nanstd(normal_vals)) if len(normal_vals) else None,
                "anomaly_mean": float(np.nanmean(anomaly_vals)) if len(anomaly_vals) else None,
                "anomaly_std": float(np.nanstd(anomaly_vals)) if len(anomaly_vals) else None,
            })
        else:
            top_normal = df.loc[~is_anomaly, base].value_counts().head(3)
            top_anomaly = df.loc[is_anomaly, base].value_counts().head(3)
            feature_summary.append({
                "feature": base,
                "type": "categorical",
                "normal_top_values": [{"value": str(k), "count": int(v)} for k, v in top_normal.items()],
                "anomaly_top_values": [{"value": str(k), "count": int(v)} for k, v in top_anomaly.items()],
            })

    return {
        "meta": {
            "row_count": n_rows,
            "feature_count_raw": len(feature_cols_raw),
            "feature_count_processed": n_features,
            "label_column": label_column if mode == "supervised" else None,
            "mode": mode,
            "missing_value_report": missing_report,
            "notes": notes,
            "training_rows": int(len(X_train_tensor)),
            "device": str(device),
        },
        "training": {
            "epochs": epochs,
            "loss_history": loss_history,
            "final_loss": loss_history[-1] if loss_history else None,
        },
        "threshold": {"value": threshold, "method": threshold_method},
        "metrics": metrics,
        "errors": [float(e) for e in errors],
        "rows": rows_out,
        "anomaly_count": int(is_anomaly.sum()),
        "feature_summary": feature_summary,
    }
