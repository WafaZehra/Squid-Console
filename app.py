"""
Run with:  run cd backend && pip install -r requirements.txt && python app.py
Then open: http://127.0.0.1:5000
"""

import os
import uuid
from flask import Flask, jsonify, request, send_from_directory
import model

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB CSVs ought to be plenty


def _bool_form(value, default=True):
    if value is None:
        return default
    return str(value).strip().lower() not in ("false", "0", "no")


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/api/preview", methods=["POST"])
def preview():
    file = request.files.get("file")
    if file is None or file.filename == "":
        return jsonify({"error": "No CSV file was attached to the request."}), 400
    if not file.filename.lower().endswith(".csv"):
        return jsonify({"error": "Only .csv files are accepted right now."}), 400

    file_id = f"{uuid.uuid4().hex}.csv"
    path = os.path.join(UPLOAD_DIR, file_id)
    file.save(path)

    has_header = _bool_form(request.form.get("has_header"), default=True)
    try:
        data = model.preview_csv(path, has_header=has_header)
    except Exception as exc:  # noqa: BLE001 — surface a readable message to the UI
        os.remove(path)
        return jsonify({"error": f"Could not read this CSV: {exc}"}), 400

    data["file_id"] = file_id
    data["original_filename"] = file.filename
    return jsonify(data)


@app.route("/api/analyze", methods=["POST"])
def analyze():
    payload = request.get_json(force=True, silent=True) or {}
    file_id = payload.get("file_id")
    if not file_id:
        return jsonify({"error": "Missing file_id — upload the CSV again."}), 400

    path = os.path.join(UPLOAD_DIR, file_id)
    if not os.path.isfile(path) or not os.path.abspath(path).startswith(os.path.abspath(UPLOAD_DIR)):
        return jsonify({"error": "That upload has expired — please re-upload the CSV."}), 404

    try:
        result = model.run_analysis(
            path,
            has_header=bool(payload.get("has_header", True)),
            label_column=payload.get("label_column") or None,
            exclude_columns=payload.get("exclude_columns") or [],
            sensitivity=payload.get("sensitivity", "balanced"),
            epochs=int(payload.get("epochs", 120)),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"The analysis failed: {exc}"}), 500
    finally:
        if os.path.isfile(path):
            os.remove(path)

    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=False, port=5000)
