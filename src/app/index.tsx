import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  CameraView,
  useCameraPermissions,
} from 'expo-camera';

import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';

import { supabase } from '../lib/supabase';
import WebCamera, { type WebCameraHandle } from '../components/WebCamera';

type CapturedPhoto = {
  name: string;
  base64: string;
  contentType: string;
  localUri?: string;
};

export default function HomeScreen() {
  // =========================================================
  // SUPABASE AUTH
  // =========================================================

  useEffect(() => {
    const initializeSupabaseAuth = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          console.log('SUPABASE SESSION READY');
          return;
        }

        const { data, error } =
          await supabase.auth.signInAnonymously();

        if (error) {
          console.log(
            'SUPABASE ANONYMOUS AUTH ERROR:',
            error.message
          );
          return;
        }

        console.log(
          'SUPABASE ANONYMOUS AUTH READY:',
          data.user?.id
        );
      } catch (error) {
        console.log(
          'SUPABASE AUTH INITIALIZATION ERROR:',
          error
        );
      }
    };

    initializeSupabaseAuth();
  }, []);

  // =========================================================
  // CAMERA STATE
  // =========================================================

  const [permission, requestPermission] =
    useCameraPermissions();

  const [cameraVisible, setCameraVisible] =
    useState(false);

  const [capturing, setCapturing] =
    useState(false);

  const [completed, setCompleted] =
    useState(false);

  const [cameraError, setCameraError] =
    useState<string | null>(null);

  const [facing, setFacing] =
    useState<'back' | 'front'>('back');

  const cameraRef =
    useRef<CameraView>(null);

  const webCameraRef =
    useRef<WebCameraHandle>(null);

  const cameraReadyRef =
    useRef(false);

  const captureRunningRef =
    useRef(false);

  // =========================================================
  // SOS STATE
  // =========================================================

  const sosIdRef =
    useRef<string | null>(null);

  const capturedPhotosRef =
    useRef<CapturedPhoto[]>([]);

  // =========================================================
  // WAIT
  // =========================================================

  const wait = (ms: number) =>
    new Promise<void>((resolve) =>
      setTimeout(resolve, ms)
    );

  // =========================================================
  // WAIT FOR CAMERA
  // =========================================================

  const waitForCameraReady = async (
    timeout = 12000
  ) => {
    const started = Date.now();

    while (
      !cameraReadyRef.current &&
      !cameraError &&
      Date.now() - started < timeout
    ) {
      await wait(100);
    }

    if (cameraError) {
      throw new Error(cameraError);
    }

    if (!cameraReadyRef.current) {
      throw new Error(
        Platform.OS === 'web'
          ? 'Browser camera did not become ready. Please allow camera access and reload the page.'
          : 'Camera did not become ready.'
      );
    }
  };

  // =========================================================
  // CREATE NATIVE SOS FOLDER
  // =========================================================

  const createNativeEvidenceFolder = async (
    sosId: string
  ) => {
    if (Platform.OS === 'web') {
      return null;
    }

    const folder =
      `${FileSystem.documentDirectory}GoTogetherSOS/${sosId}/`;

    await FileSystem.makeDirectoryAsync(
      folder,
      {
        intermediates: true,
      }
    );

    console.log(
      'NATIVE SOS FOLDER:',
      folder
    );

    return folder;
  };

  // =========================================================
  // CAPTURE ONE PHOTO
  // =========================================================

  const capturePhoto = async (
    filename: string,
    nativeFolder: string | null
  ): Promise<CapturedPhoto | null> => {
    try {
      console.log(
        'TAKING PHOTO:',
        filename,
        Platform.OS
      );

      // =====================================================
      // WEB
      // =====================================================

      if (Platform.OS === 'web') {
        if (!webCameraRef.current) {
          console.log(
            'WEB CAMERA REF NOT READY'
          );

          return null;
        }

        try {
          const webBase64 =
            await webCameraRef.current.takePhoto();

          if (!webBase64) {
            console.log(
              'WEB PHOTO HAD NO IMAGE DATA:',
              filename
            );

            return null;
          }

          console.log(
            'WEB PHOTO CAPTURED:',
            filename
          );

          return {
            name: filename,
            base64: webBase64,
            contentType: 'image/jpeg',
          };
        } catch (error) {
          console.log(
            `WEB PHOTO ERROR (${filename}):`,
            error
          );

          return null;
        }
      }

      // =====================================================
      // ANDROID / IOS
      // =====================================================

      if (!cameraRef.current) {
        console.log(
          'CAMERA REF NOT READY'
        );

        return null;
      }

      const photo =
        await cameraRef.current.takePictureAsync({
          quality: 0.7,
        });

      if (!photo?.uri) {
        console.log(
          'NATIVE PHOTO URI NOT AVAILABLE:',
          filename
        );

        return null;
      }

      if (!nativeFolder) {
        throw new Error(
          'Native evidence folder is missing.'
        );
      }

      const destination =
        `${nativeFolder}${filename}`;

      await FileSystem.copyAsync({
        from: photo.uri,
        to: destination,
      });

      console.log(
        'NATIVE PHOTO SAVED:',
        destination
      );

      const base64 =
        await FileSystem.readAsStringAsync(
          destination,
          {
            encoding:
              FileSystem.EncodingType.Base64,
          }
        );

      return {
        name: filename,
        base64,
        contentType: 'image/jpeg',
        localUri: destination,
      };
    } catch (error) {
      console.log(
        `PHOTO ERROR (${filename}):`,
        error
      );

      return null;
    }
  };
  // =========================================================
  // SAVE LOCATION ON PHONE
  // =========================================================

  const saveLocationLocally = async (
    nativeFolder: string | null,
    location: Location.LocationObject | null,
    timestamp: string
  ) => {
    if (
      Platform.OS === 'web' ||
      !nativeFolder
    ) {
      return;
    }

    const locationData = {
      sosId: sosIdRef.current,
      timestamp,
      latitude:
        location?.coords.latitude ?? null,
      longitude:
        location?.coords.longitude ?? null,
      accuracy:
        location?.coords.accuracy ?? null,
    };

    const locationPath =
      `${nativeFolder}location.json`;

    await FileSystem.writeAsStringAsync(
      locationPath,
      JSON.stringify(
        locationData,
        null,
        2
      )
    );

    console.log(
      'LOCATION SAVED LOCALLY:',
      locationPath
    );
  };

  // =========================================================
  // ENSURE SUPABASE SESSION
  // =========================================================

  const ensureSupabaseSession =
    async () => {
      const {
        data: { session },
      } =
        await supabase.auth.getSession();

      if (session) {
        return session;
      }

      const {
        data,
        error,
      } =
        await supabase.auth.signInAnonymously();

      if (
        error ||
        !data.session
      ) {
        throw new Error(
          error?.message ||
          'Supabase authentication failed.'
        );
      }

      return data.session;
    };

  // =========================================================
  // UPLOAD SOS
  // =========================================================

  const uploadSOS = async (
    timestamp: string,
    location: Location.LocationObject | null
  ) => {
    const sosId =
      sosIdRef.current;

    const photos =
      capturedPhotosRef.current;

    if (!sosId) {
      throw new Error(
        'SOS ID is missing.'
      );
    }

    if (photos.length !== 4) {
      throw new Error(
        `Expected 4 photos but captured ${photos.length}.`
      );
    }

    await ensureSupabaseSession();

    console.log(
      '===== SOS SERVER UPLOAD START ====='
    );

    const payloadPhotos =
      photos.map((photo) => ({
        name: photo.name,
        base64: photo.base64,
        contentType:
          photo.contentType,
      }));

    const {
      data,
      error,
    } =
      await supabase.functions.invoke(
        'sos-upload',
        {
          body: {
            sosId,
            timestamp,

            latitude:
              location?.coords.latitude ??
              null,

            longitude:
              location?.coords.longitude ??
              null,

            accuracy:
              location?.coords.accuracy ??
              null,

            photos:
              payloadPhotos,
          },
        }
      );

    if (error) {
      console.log(
        'SUPABASE FUNCTION ERROR:',
        error
      );

      throw new Error(
        error.message ||
        'SOS server upload failed.'
      );
    }

    if (!data?.success) {
      console.log(
        'SOS SERVER ERROR:',
        data
      );

      throw new Error(
        data?.error ||
        'SOS server rejected the upload.'
      );
    }

    console.log(
      'SOS SERVER UPLOAD SUCCESS:',
      data
    );

    console.log(
      '===== SOS SERVER UPLOAD COMPLETE ====='
    );

    return data;
  };

  // =========================================================
  // CAPTURE ALL FOUR PHOTOS
  // =========================================================

  const captureAllPhotos = async (
    timestamp: string,
    locationPromise:
      Promise<Location.LocationObject | null>
  ) => {
    if (
      captureRunningRef.current
    ) {
      return;
    }

    captureRunningRef.current =
      true;

    setCapturing(true);
    setCameraError(null);

    try {
      console.log(
        '===== SOS CAPTURE START ====='
      );

      const sosId =
        sosIdRef.current ||
        `SOS-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;

      sosIdRef.current =
        sosId;

      const nativeFolder =
        await createNativeEvidenceFolder(
          sosId
        );

      // =====================================================
      // BACK CAMERA
      // =====================================================

      await waitForCameraReady();

      const backPhoto1 =
        await capturePhoto(
          'back_01.jpg',
          nativeFolder
        );

      if (!backPhoto1) {
        throw new Error(
          'Back camera photo 1 failed.'
        );
      }

      capturedPhotosRef.current.push(
        backPhoto1
      );

      console.log(
        'BACK PHOTO 1 COMPLETE'
      );

      await wait(500);

      const backPhoto2 =
        await capturePhoto(
          'back_02.jpg',
          nativeFolder
        );

      if (!backPhoto2) {
        throw new Error(
          'Back camera photo 2 failed.'
        );
      }

      capturedPhotosRef.current.push(
        backPhoto2
      );

      console.log(
        'BACK PHOTO 2 COMPLETE'
      );

      // =====================================================
      // FRONT CAMERA
      // =====================================================

      cameraReadyRef.current =
        false;

      setCameraError(null);

      setFacing('front');

      // Browser/native camera needs time
      // to switch physical camera.
      await wait(
        Platform.OS === 'web'
          ? 1000
          : 500
      );

      await waitForCameraReady();

      const frontPhoto1 =
        await capturePhoto(
          'front_01.jpg',
          nativeFolder
        );

      if (!frontPhoto1) {
        throw new Error(
          'Front camera photo 1 failed.'
        );
      }

      capturedPhotosRef.current.push(
        frontPhoto1
      );

      console.log(
        'FRONT PHOTO 1 COMPLETE'
      );

      await wait(500);

      const frontPhoto2 =
        await capturePhoto(
          'front_02.jpg',
          nativeFolder
        );

      if (!frontPhoto2) {
        throw new Error(
          'Front camera photo 2 failed.'
        );
      }

      capturedPhotosRef.current.push(
        frontPhoto2
      );

      console.log(
        'FRONT PHOTO 2 COMPLETE'
      );

      // =====================================================
      // VERIFY FOUR PHOTOS
      // =====================================================

      console.log(
        'TOTAL PHOTOS:',
        capturedPhotosRef.current.length
      );

      if (
        capturedPhotosRef.current.length !== 4
      ) {
        throw new Error(
          'SOS did not capture all 4 photos.'
        );
      }

      // =====================================================
      // GPS
      // =====================================================

      const location =
        await locationPromise;

      console.log(
        'LOCATION READY:',
        location?.coords
      );

      await saveLocationLocally(
        nativeFolder,
        location,
        timestamp
      );

      // =====================================================
      // SERVER BACKUP
      // =====================================================

      await uploadSOS(
        timestamp,
        location
      );

      console.log(
        '===== SOS COMPLETE ====='
      );

      setCapturing(false);
      setCompleted(true);
    } catch (error) {
      console.log(
        '===== SOS ERROR =====',
        error
      );

      setCapturing(false);

      const message =
        error instanceof Error
          ? error.message
          : 'SOS evidence could not be completed.';

      setCameraError(message);

      if (Platform.OS !== 'web') {
        Alert.alert(
          'SOS Error',
          message
        );
      }
    } finally {
      captureRunningRef.current =
        false;

      console.log(
        '===== SOS CAPTURE END ====='
      );
    }
  };

  // =========================================================
  // SOS BUTTON
  // =========================================================

  const handleSOS = async () => {
    if (
      captureRunningRef.current
    ) {
      return;
    }

    // =======================================================
    // CAMERA PERMISSION
    // =======================================================

    if (!permission?.granted) {
      const result =
        await requestPermission();

      if (!result.granted) {
        Alert.alert(
          'Camera Permission Required',
          'Camera access is required to activate SOS.'
        );

        return;
      }
    }

    // =======================================================
    // RESET
    // =======================================================

    capturedPhotosRef.current =
      [];

    sosIdRef.current =
      `SOS-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    cameraReadyRef.current =
      false;

    setCameraError(null);
    setFacing('back');
    setCompleted(false);
    setCapturing(false);

    // =======================================================
    // TIMESTAMP
    // =======================================================

    const timestamp =
      new Date().toISOString();

    // =======================================================
    // START GPS IN PARALLEL
    // =======================================================

    const locationPromise =
      (async () => {
        try {
          const permissionResult =
            await Location.requestForegroundPermissionsAsync();

          if (
            permissionResult.status !==
            'granted'
          ) {
            console.log(
              'LOCATION PERMISSION NOT GRANTED'
            );

            return null;
          }

          const location =
            await Location.getCurrentPositionAsync(
              {
                accuracy:
                  Location.Accuracy.High,
              }
            );

          console.log(
            'GPS LATITUDE:',
            location.coords.latitude
          );

          console.log(
            'GPS LONGITUDE:',
            location.coords.longitude
          );

          console.log(
            'GPS ACCURACY:',
            location.coords.accuracy
          );

          return location;
        } catch (error) {
          console.log(
            'LOCATION ERROR:',
            error
          );

          return null;
        }
      })();

    // =======================================================
    // OPEN CAMERA
    // =======================================================

    setCameraVisible(true);

    // Give CameraView time to mount.
    await wait(
      Platform.OS === 'web'
        ? 700
        : 250
    );

    // =======================================================
    // START CAPTURE
    // =======================================================

    captureAllPhotos(
      timestamp,
      locationPromise
    );
  };

  // =========================================================
  // CAMERA SCREEN
  // =========================================================

  if (cameraVisible) {
    return (
      <View
        style={styles.cameraContainer}
      >
                {Platform.OS === 'web' ? (
          <WebCamera
            ref={webCameraRef}
            facing={facing}
            onReady={() => {
              console.log(
                'WEB CAMERA READY:',
                facing
              );

              cameraReadyRef.current = true;
              setCameraError(null);
            }}
            onError={(message) => {
              console.log(
                'WEB CAMERA ERROR:',
                message
              );

              cameraReadyRef.current = false;
              setCameraError(message);
            }}
          />
        ) : (
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing={facing}
            onCameraReady={() => {
              console.log(
                'CAMERA READY:',
                facing,
                Platform.OS
              );

              cameraReadyRef.current = true;
              setCameraError(null);
            }}
            onMountError={(event) => {
              console.log(
                'CAMERA MOUNT ERROR:',
                event.message
              );

              cameraReadyRef.current = false;

              setCameraError(
                event.message ||
                'The camera could not be started.'
              );
            }}
          />
        )}

        <View style={styles.cameraOverlay}>
          {!completed ? (
            <>
              <View style={styles.statusPill}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>
                  SOS ACTIVATED
                </Text>
              </View>

              <Text style={styles.checkingMessage}>
                We're checking you.
              </Text>

              <View style={styles.liveCard}>
                <Text style={styles.liveTitle}>
                  GoTogether Safety
                </Text>

                <Text style={styles.liveSubtitle}>
                  Your safety evidence is being secured.
                </Text>
              </View>

              {cameraError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>
                    Camera / SOS Error
                  </Text>

                  <Text style={styles.errorText}>
                    {cameraError}
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.successCircle}>
                <Text style={styles.successIcon}>
                  ✓
                </Text>
              </View>

              <Text style={styles.sosActive}>
                SOS ACTIVATED
              </Text>

              <Text style={styles.checkingMessage}>
                Your safety backup is complete.
              </Text>

              <View style={styles.completedBox}>
                <Text style={styles.completedTitle}>
                  Safety backup complete
                </Text>

                <View style={styles.completedRow}>
                  <Text style={styles.checkmark}>✓</Text>
                  <Text style={styles.completedText}>
                    4 photos captured
                  </Text>
                </View>

                <View style={styles.completedRow}>
                  <Text style={styles.checkmark}>✓</Text>
                  <Text style={styles.completedText}>
                    Location recorded
                  </Text>
                </View>

                <View style={styles.completedRow}>
                  <Text style={styles.checkmark}>✓</Text>
                  <Text style={styles.completedText}>
                    Timestamp recorded
                  </Text>
                </View>

                <View style={styles.completedRow}>
                  <Text style={styles.checkmark}>✓</Text>
                  <Text style={styles.completedText}>
                    Secure backup complete
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>
      </View>
    );
  }

  // =========================================================
  // SAFETY CENTER
  // =========================================================

  return (
    <View
      style={styles.container}
    >
      <Text
        style={styles.brand}
      >
        GoTogether
      </Text>

      <Text
        style={styles.title}
      >
        Safety Center
      </Text>

      <Text
        style={styles.description}
      >
        If you feel unsafe during your
        journey, use the SOS button.
      </Text>

      <Pressable
        style={[
          styles.sosButton,
          capturing &&
            styles.sosButtonDisabled,
        ]}
        onPress={handleSOS}
        disabled={capturing}
      >
        <Text
          style={styles.sosButtonText}
        >
          SOS
        </Text>
      </Pressable>

      <Text
        style={styles.helperText}
      >
        SOS automatically captures
        safety evidence and records
        your location.
      </Text>
    </View>
  );
}

// ===========================================================
// STYLES
// ===========================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  brand: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1769ff',
    marginBottom: 12,
  },

  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 16,
  },

  description: {
    fontSize: 16,
    color: '#555555',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 40,
    maxWidth: 320,
  },

  sosButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#d90429',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },

  sosButtonDisabled: {
    opacity: 0.7,
  },

  sosButtonText: {
    color: '#ffffff',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: 2,
  },

  helperText: {
    marginTop: 24,
    fontSize: 14,
    color: '#777777',
    textAlign: 'center',
    maxWidth: 300,
  },

  cameraContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },

  camera: {
    flex: 1,
  },

  cameraOverlay: {
    position: 'absolute',
    top: 70,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d90429',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 30,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },

  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#ffffff',
    marginRight: 10,
  },

  statusText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  sosActive: {
    color: '#ffffff',
    fontSize: 25,
    fontWeight: '800',
    backgroundColor: '#d90429',
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 14,
    marginTop: 18,
  },

  checkingMessage: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '600',
    marginTop: 14,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
  },

  liveCard: {
    marginTop: 20,
    width: '100%',
    maxWidth: 360,
    backgroundColor: 'rgba(0,0,0,0.68)',
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: 'center',
  },

  liveTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },

  liveSubtitle: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 14,
    marginTop: 6,
    textAlign: 'center',
  },

  successCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#18a558',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },

  successIcon: {
    color: '#ffffff',
    fontSize: 38,
    fontWeight: '800',
  },

  completedBox: {
    marginTop: 20,
    width: '100%',
    maxWidth: 360,
    backgroundColor: 'rgba(0,0,0,0.78)',
    paddingHorizontal: 20,
    paddingVertical: 19,
    borderRadius: 18,
  },

  completedTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 12,
  },

  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 5,
  },

  checkmark: {
    color: '#35d07f',
    fontSize: 19,
    fontWeight: '800',
    width: 28,
  },

  completedText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },

  errorBox: {
    marginTop: 18,
    width: '100%',
    maxWidth: 340,
    backgroundColor: 'rgba(120,0,0,0.92)',
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderRadius: 14,
  },

  errorTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 7,
    textAlign: 'center',
  },

  errorText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});






