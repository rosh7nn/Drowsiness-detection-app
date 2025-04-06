from flask import Flask, request, jsonify
import numpy as np
import tensorflow.lite as tflite
import cv2
from flask_cors import CORS
import threading
import os
from collections import deque
import time

app = Flask(__name__)
CORS(app, resources={r"/detect-video": {"origins": "*"}})

# Load TFLite model
try:
    interpreter = tflite.Interpreter(model_path="drowsiness_model.tflite")
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    input_shape = input_details[0]['shape']  # Example: [1, 24, 24, 3]
    MODEL_IMG_SIZE = (input_shape[1], input_shape[2])  # (Height, Width)
    REQUIRED_CHANNELS = input_shape[3]  # 3 if RGB, 1 if grayscale
    model_lock = threading.Lock()  # Prevent parallel access to interpreter
    print(f"✅ Model loaded successfully. Expected shape: {input_shape}")
except Exception as e:
    print(f"❌ Error loading model: {e}")
    interpreter = None

previous_predictions = deque(maxlen=5)  # Last 5 frames for smoothing

def crop_eyes(image):
    """Detects eyes and crops a zoomed-in region."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')

    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))

    for (x, y, w, h) in faces:
        face_roi = gray[y:y+h, x:x+w]
        eyes = eye_cascade.detectMultiScale(face_roi)

        if len(eyes) >= 2:
            ex1, ey1, ew1, eh1 = eyes[0]
            ex2, ey2, ew2, eh2 = eyes[1]

            # Ensure eyes are in correct order (left to right)
            if ex1 > ex2:
                ex1, ex2 = ex2, ex1
                ey1, ey2 = ey2, ey1
                ew1, ew2 = ew2, ew1
                eh1, eh2 = eh2, eh1

            # Merge both eyes into a single zoomed region
            eye_x = ex1
            eye_y = min(ey1, ey2)
            eye_w = ex2 + ew2 - ex1
            eye_h = max(eh1, eh2)

            eye_roi = face_roi[eye_y:eye_y + eye_h, eye_x:eye_x + eye_w]

            # Zoom in by resizing to 2x for better detail
            zoomed_eye_roi = cv2.resize(eye_roi, (MODEL_IMG_SIZE[0] * 2, MODEL_IMG_SIZE[1] * 2))

            return zoomed_eye_roi

    return None  # No eyes detected

def preprocess_image(image):
    """Preprocesses the image: crops eyes, resizes, normalizes."""
    eye_roi = crop_eyes(image)
    if eye_roi is None:
        return None  # No eyes detected

    resized = cv2.resize(eye_roi, MODEL_IMG_SIZE, interpolation=cv2.INTER_AREA)
    normalized = resized.astype(np.float32) / 255.0

    if REQUIRED_CHANNELS == 3:
        normalized = cv2.cvtColor(normalized, cv2.COLOR_GRAY2RGB)

    reshaped = np.expand_dims(normalized, axis=0)
    return reshaped

def predict_drowsiness(image):
    """Runs inference and determines drowsiness."""
    if interpreter is None:
        return "Model not loaded"

    image = preprocess_image(image)

    # If no eyes are detected, consider it as "Drowsy"
    if image is None:
        return "Drowsy"

    with model_lock:
        interpreter.set_tensor(input_details[0]['index'], image)
        interpreter.invoke()
        output_data = interpreter.get_tensor(output_details[0]['index'])

    if isinstance(output_data, np.ndarray) and output_data.size > 0:
        probability = float(output_data[0][0])
        print(f"✅ Model output: {probability}")

        previous_predictions.append(probability)
        smoothed_prob = np.mean(previous_predictions)

        return "Drowsy" if smoothed_prob > 0.5 else "Awake"
    else:
        return "Drowsy"  # If model fails, assume drowsy for safety

@app.route("/")
def home():
    return "Flask backend is running!"

@app.route('/detect-video', methods=['POST'])
def detect_video():
    if 'frame' not in request.files:
        return jsonify({"error": "No video frame provided"}), 400
    
    frame = request.files['frame']
    frame_path = os.path.join("uploads", frame.filename)
    frame.save(frame_path)
    print(f"✅ Received frame: {frame_path}")

    start_time = time.time()
    image = cv2.imread(frame_path)

    if image is None:
        return jsonify({"error": "Failed to read image"}), 400
    
    prediction = predict_drowsiness(image)
    processing_time = time.time() - start_time

    return jsonify({"status": prediction, "processing_time": round(processing_time, 4)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug=True, threaded=True)
