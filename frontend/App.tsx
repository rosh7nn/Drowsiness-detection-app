import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Button,
  Alert,
  StyleSheet,
  Image,
  TextInput,
  Linking,
} from "react-native";
import { Camera, useCameraDevice, useCameraPermission } from "react-native-vision-camera";

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [drowsiness, setDrowsiness] = useState("Scanning...");
  const [image, setImage] = useState<string | null>(null);
  const cameraRef = useRef<Camera>(null!);
  const device = useCameraDevice("front");
  const [isCapturing, setIsCapturing] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");

  const [drowsyCount, setDrowsyCount] = useState(0);


  useEffect(() => {
    (async () => {
      if (!hasPermission) await requestPermission();
    })();
  }, [hasPermission]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const startRealTimeDetection = () => {
    if (!cameraRef.current) return Alert.alert("Error", "Camera not ready");

    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
      return Alert.alert("Error", "Enter a valid 10-digit Indian phone number.");
    }

    setIsCapturing(true);
    setDrowsiness("Scanning...");

    intervalRef.current = setInterval(async () => {
      await captureFrame(formattedNumber);
    }, 2000);
  };

  const stopRealTimeDetection = () => {
    setIsCapturing(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const captureFrame = async (formattedNumber: string) => {
    if (!cameraRef.current) return;
  
    try {
      const photo = await cameraRef.current.takePhoto();
      if (!photo?.path) return;
  
      const imagePath = `file://${photo.path}`;
      console.log("Captured frame path:", imagePath);
  
      setImage(imagePath);
      sendFrameToServer(imagePath, formattedNumber);
    } catch (error) {
      console.error("Capture Error:", error);
      setDrowsiness("Error capturing frame");
    }
  };

  //const response = await fetch("http://192.168.105.42:5002/detect-video", for external phone 
  //const response = await fetch("http://10.0.2.2:5002/detect-video", for localhost (emulator)
  //"http://192.168.130.42:5002/detect-video"

  const sendFrameToServer = async (imagePath: string, formattedNumber: string) => {
    const formData = new FormData();
    formData.append("frame", {
      uri: imagePath,
      type: "image/jpeg",
      name: "frame.jpg",
    });
    
    try {
      console.log("Sending request to server...");
      const response = await fetch("http://192.168.130.42:5002/detect-video", {
        method: "POST",
        body: formData,
        headers: { "Accept": "application/json", "Content-Type": "multipart/form-data" },
      });
  
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      const data = await response.json();
      console.log("Response from server:", data);
      setDrowsiness(data.status);
  
      if (data.status === "Drowsy") {
        setDrowsyCount(prevCount => {
          const newCount = prevCount + 1;
          if (newCount >= 3) { // Trigger alert only after 3 consecutive detections
            sendSMS(formattedNumber, "🚨 Alert: The driver is drowsy! Please check on them.");
            return 0; // Reset count after sending alert
          }
          return newCount;
        });
      } else {
        setDrowsyCount(0);
      }
    } catch (error) {
      console.error("Fetch Error:", error);
      setDrowsiness("Error in detection: Unable to connect to server");
    }
  };
  

  const formatPhoneNumber = (number: string) => {
    const cleaned = number.replace(/\D/g, ""); // Remove non-numeric characters
    if (cleaned.length === 10) {
      return `+91${cleaned}`;
    }
    return null;
  };

  
const sendSMS = async (phone: string, message: string) => {
  const url = `sms:${phone}?body=${encodeURIComponent(message)}`;
  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    Linking.openURL(url);
  } else {
    Alert.alert("Error", "Messaging app is not available.");
  }
};


  if (!device) return <Text>No camera available</Text>;
  if (!hasPermission) return <Text>Requesting camera permissions...</Text>;

  return (
    <View style={styles.container}>
      <Camera ref={cameraRef} style={styles.camera} device={device} isActive={true} photo />

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Enter 10-digit Emergency Contact"
          keyboardType="phone-pad"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
        />
      </View>

      <View style={styles.buttonContainer}>
        <Button title="Start Detection" onPress={startRealTimeDetection} disabled={isCapturing} />
        <Button title="Stop Detection" onPress={stopRealTimeDetection} disabled={!isCapturing} />
      </View>

      <Text style={[styles.result, getStatusStyle(drowsiness)]}>{drowsiness}</Text>
      {image && <Image source={{ uri: image }} style={styles.preview} />}
    </View>
  );
}

const getStatusStyle = (status: string) => {
  switch (status) {
    case "Scanning...": return styles.scanning;
    case "Drowsy": return styles.warning;
    case "Awake": return styles.success;
    case "Error capturing frame":
    case "Error in detection": return styles.error;
    default: return styles.default;
  }
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  camera: { width: "100%", height: 400 },
  inputContainer: { width: "80%", marginTop: 20 },
  input: { borderWidth: 1, padding: 10, width: "100%", borderRadius: 5 },
  buttonContainer: { flexDirection: "row", marginTop: 20 },
  result: { fontSize: 20, marginTop: 20 },
  scanning: { color: "blue" },
  success: { color: "green" },
  warning: { color: "orange" },
  error: { color: "red" },
  default: { color: "black" },
  preview: { width: 100, height: 100, marginTop: 10 },
});
