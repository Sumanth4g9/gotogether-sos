import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { StyleSheet, Text, View } from "react-native";

export type WebCameraHandle = {
  takePhoto: () => Promise<string>;
};

type WebCameraProps = {
  facing: "back" | "front";
  onReady?: () => void;
  onError?: (message: string) => void;
};

const WebCamera = forwardRef<WebCameraHandle, WebCameraProps>(
  ({ facing, onReady, onError }, ref) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const stopStream = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };

    useEffect(() => {
      let cancelled = false;

      const startCamera = async () => {
        setReady(false);
        setError(null);
        stopStream();

        try {
          if (
            typeof navigator === "undefined" ||
            !navigator.mediaDevices?.getUserMedia
          ) {
            throw new Error(
              "This browser does not support camera access."
            );
          }

          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: facing === "back" ? "environment" : "user",
            },
            audio: false,
          });

          if (cancelled) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

          streamRef.current = stream;

          const video = videoRef.current;

          if (!video) {
            throw new Error("Camera video element is not available.");
          }

          video.srcObject = stream;
          video.muted = true;
          video.playsInline = true;

          await video.play();

          const waitUntilReady = () => {
            if (
              video.readyState >= 2 &&
              video.videoWidth > 0 &&
              video.videoHeight > 0
            ) {
              if (!cancelled) {
                setReady(true);
                onReady?.();
              }
              return;
            }

            if (!cancelled) {
              window.setTimeout(waitUntilReady, 100);
            }
          };

          waitUntilReady();
        } catch (cameraError) {
          const message =
            cameraError instanceof Error
              ? cameraError.message
              : "Unable to start camera.";

          if (!cancelled) {
            setError(message);
            onError?.(message);
          }
        }
      };

      startCamera();

      return () => {
        cancelled = true;
        stopStream();
      };
    }, [facing]);

    useImperativeHandle(ref, () => ({
      takePhoto: async () => {
        const video = videoRef.current;

        if (!video) {
          throw new Error("Camera is not available.");
        }

        for (let attempt = 0; attempt < 30; attempt++) {
          if (
            video.readyState >= 2 &&
            video.videoWidth > 0 &&
            video.videoHeight > 0
          ) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (
          video.readyState < 2 ||
          video.videoWidth === 0 ||
          video.videoHeight === 0
        ) {
          throw new Error("Camera frame is not ready yet.");
        }

        const canvas = document.createElement("canvas");

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("Unable to create camera image.");
        }

        context.drawImage(
          video,
          0,
          0,
          canvas.width,
          canvas.height
        );

        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);

        const commaIndex = dataUrl.indexOf(",");

        if (commaIndex === -1) {
          throw new Error("Unable to create camera image data.");
        }

        return dataUrl.substring(commaIndex + 1);
      },
    }));

    return (
      <View style={styles.container}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />

        {!ready && !error && (
          <View style={styles.overlay}>
            <Text style={styles.overlayText}>Starting camera...</Text>
          </View>
        )}

        {error && (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </View>
    );
  }
);

WebCamera.displayName = "WebCamera";

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: "#000",
    position: "relative",
  },

  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  overlayText: {
    color: "#fff",
    fontSize: 16,
  },
  errorText: {
    color: "#fff",
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 20,
  },
});

export default WebCamera;

