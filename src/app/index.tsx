import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';

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
  // Profile and emergency contact setup
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [userName, setUserName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const raw = await AsyncStorage.getItem('gotogether_sos_profile');

        if (raw) {
          const saved = JSON.parse(raw) as {
            userName?: string;
            contactName?: string;
            contactPhone?: string;
          };

          setUserName(saved.userName ?? '');
          setContactName(saved.contactName ?? '');
          setContactPhone(saved.contactPhone ?? '');

          setProfileReady(
            Boolean(
              saved.userName?.trim() &&
              saved.contactName?.trim() &&
              saved.contactPhone?.trim()
            )
          );
        }
      } catch (error) {
        console.log('PROFILE LOAD ERROR:', error);
      } finally {
        setProfileLoaded(true);
      }
    };

    loadProfile();
  }, []);

  const saveProfile = async () => {
    const cleanName = userName.trim();
    const cleanContactName = contactName.trim();
    const cleanPhone = contactPhone.replace(/[\s()+-]/g, '');

    if (!cleanName || !cleanContactName || !cleanPhone) {
      Alert.alert(
        'Complete setup',
        'Enter your name, emergency contact name, and WhatsApp number.'
      );
      return;
    }

    if (!/^\d{10,15}$/.test(cleanPhone)) {
      Alert.alert(
        'Check phone number',
        'Enter a valid phone number. For India, a 10-digit number is accepted.'
      );
      return;
    }

    const internationalPhone =
      cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

    setProfileSaving(true);

    try {
      await AsyncStorage.setItem(
        'gotogether_sos_profile',
        JSON.stringify({
          userName: cleanName,
          contactName: cleanContactName,
          contactPhone: internationalPhone,
        })
      );

      setUserName(cleanName);
      setContactName(cleanContactName);
      setContactPhone(internationalPhone);
      setProfileReady(true);

      Alert.alert(
        'Setup saved',
        'Your emergency contact details are saved on this device.'
      );
    } catch (error) {
      console.log('PROFILE SAVE ERROR:', error);
      Alert.alert('Could not save', 'Please try saving your details again.');
    } finally {
      setProfileSaving(false);
    }
  };

  // Supabase anonymous session
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
          console.log('SUPABASE ANONYMOUS AUTH ERROR:', error.message);
          return;
        }

        console.log('SUPABASE ANONYMOUS AUTH READY:', data.user?.id);
      } catch (error) {
        console.log('SUPABASE AUTH INITIALIZATION ERROR:', error);
      }
    };

    initializeSupabaseAuth();
  }, []);

  // Camera and capture state
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraVisible, setCameraVisible] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [serverUploadSucceeded, setServerUploadSucceeded] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [videoMode, setVideoMode] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const webCameraRef = useRef<WebCameraHandle>(null);
  const cameraReadyRef = useRef(false);
  const captureRunningRef = useRef(false);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);

  const sosIdRef = useRef<string | null>(null);
  const capturedPhotosRef = useRef<CapturedPhoto[]>([]);

  const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  const waitForCameraReady = async (timeout = 12000) => {
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
          ? 'Browser camera did not become ready. Allow camera access and reload.'
          : 'Camera did not become ready.'
      );
    }
  };

  const createNativeEvidenceFolder = async (sosId: string) => {
    if (Platform.OS === 'web') {
      return null;
    }

    const folder =
      `${FileSystem.documentDirectory}GoTogetherSOS/${sosId}/`;

    await FileSystem.makeDirectoryAsync(folder, {
      intermediates: true,
    });

    console.log('NATIVE SOS FOLDER:', folder);
    return folder;
  };

  // Capture one photo
  const capturePhoto = async (
    filename: string,
    nativeFolder: string | null
  ): Promise<CapturedPhoto | null> => {
    try {
      console.log('TAKING PHOTO:', filename, Platform.OS);

      if (Platform.OS === 'web') {
        if (!webCameraRef.current) {
          console.log('WEB CAMERA REF NOT READY');
          return null;
        }

        try {
          const webBase64 =
            await webCameraRef.current.takePhoto();

          if (!webBase64) {
            console.log('WEB PHOTO HAD NO IMAGE DATA:', filename);
            return null;
          }

          return {
            name: filename,
            base64: webBase64,
            contentType: 'image/jpeg',
          };
        } catch (error) {
          console.log(`WEB PHOTO ERROR (${filename}):`, error);
          return null;
        }
      }

      if (!cameraRef.current) {
        console.log('CAMERA REF NOT READY');
        return null;
      }

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
      });

      if (!photo?.uri) {
        console.log('NATIVE PHOTO URI NOT AVAILABLE:', filename);
        return null;
      }

      if (!nativeFolder) {
        throw new Error('Native evidence folder is missing.');
      }

      const destination = `${nativeFolder}${filename}`;

      await FileSystem.copyAsync({
        from: photo.uri,
        to: destination,
      });

      const base64 = await FileSystem.readAsStringAsync(destination, {
        encoding: FileSystem.EncodingType.Base64,
      });

      console.log('NATIVE PHOTO SAVED:', destination);

      return {
        name: filename,
        base64,
        contentType: 'image/jpeg',
        localUri: destination,
      };
    } catch (error) {
      console.log(`PHOTO ERROR (${filename}):`, error);
      return null;
    }
  };

  // Record a five-second video and audio clip on Android/iOS
  const recordVideoAndAudio = async (nativeFolder: string | null) => {
    try {
      console.log('===== VIDEO + AUDIO SEQUENTIAL START =====');

      if (Platform.OS === 'web' || !nativeFolder) {
        return;
      }

      if (!cameraRef.current) {
        throw new Error('Camera is not ready.');
      }

      // Video
      setVideoMode(true);
      cameraReadyRef.current = false;

      await wait(1000);
      await waitForCameraReady();

      const video = await cameraRef.current.recordAsync({
        maxDuration: 5,
        maxFileSize: 50 * 1024 * 1024,
      });

      setVideoMode(false);
      cameraReadyRef.current = false;

      if (!video?.uri) {
        throw new Error('Video recording returned no file.');
      }

      const videoDestination =
        `${nativeFolder}evidence_video.mp4`;

      await FileSystem.copyAsync({
        from: video.uri,
        to: videoDestination,
      });

      setVideoUri(videoDestination);
      console.log('VIDEO SAVED:', videoDestination);

      await wait(800);

      // Audio
      const audioPermission =
        await AudioModule.requestRecordingPermissionsAsync();

      if (!audioPermission.granted) {
        throw new Error('Microphone permission was not granted.');
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record({ forDuration: 5 });

      console.log('AUDIO RECORDING STARTED');
      await wait(5500);
      await audioRecorder.stop();

      if (!audioRecorder.uri) {
        throw new Error('Audio recording returned no file.');
      }

      const audioDestination =
        `${nativeFolder}evidence_audio.m4a`;

      await FileSystem.copyAsync({
        from: audioRecorder.uri,
        to: audioDestination,
      });

      setAudioUri(audioDestination);
      console.log('AUDIO SAVED:', audioDestination);
      console.log('===== VIDEO + AUDIO COMPLETE =====');
    } catch (error) {
      setVideoMode(false);
      console.log('VIDEO/AUDIO RECORDING ERROR:', error);
      throw error;
    }
  };

  // Save GPS information locally
  const saveLocationLocally = async (
    nativeFolder: string | null,
    location: Location.LocationObject | null,
    timestamp: string
  ) => {
    if (Platform.OS === 'web' || !nativeFolder) {
      return;
    }

    const locationData = {
      sosId: sosIdRef.current,
      timestamp,
      latitude: location?.coords.latitude ?? null,
      longitude: location?.coords.longitude ?? null,
      accuracy: location?.coords.accuracy ?? null,
    };

    const locationPath = `${nativeFolder}location.json`;

    await FileSystem.writeAsStringAsync(
      locationPath,
      JSON.stringify(locationData, null, 2)
    );

    console.log('LOCATION SAVED LOCALLY:', locationPath);
  };

  // Ensure there is a Supabase session before uploading
  const ensureSupabaseSession = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      return session;
    }

    const { data, error } =
      await supabase.auth.signInAnonymously();

    if (error || !data.session) {
      throw new Error(
        error?.message || 'Supabase authentication failed.'
      );
    }

    return data.session;
  };
  // Upload four photos to the existing Supabase Edge Function
  const uploadSOS = async (
    timestamp: string,
    location: Location.LocationObject | null
  ) => {
    const sosId = sosIdRef.current;
    const photos = capturedPhotosRef.current;

    if (!sosId) {
      throw new Error("SOS ID is missing.");
    }

    if (photos.length !== 4) {
      throw new Error(`Expected 4 photos but captured ${photos.length}.`);
    }

    await ensureSupabaseSession();

    console.log("===== SOS SERVER UPLOAD START =====");

    const payloadPhotos = photos.map((photo) => ({
      name: photo.name,
      base64: photo.base64,
      contentType: photo.contentType,
    }));

    let payloadVideo: {
      name: string;
      base64: string;
      contentType: string;
    } | null = null;

    if (videoUri && Platform.OS !== "web") {
      const videoBase64 = await FileSystem.readAsStringAsync(videoUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      payloadVideo = {
        name: "evidence_video.mp4",
        base64: videoBase64,
        contentType: "video/mp4",
      };
    }

    const { data, error } = await supabase.functions.invoke(
      "sos-upload",
      {
        body: {
          sosId,
          timestamp,
          latitude: location?.coords.latitude ?? null,
          longitude: location?.coords.longitude ?? null,
          accuracy: location?.coords.accuracy ?? null,
          photos: payloadPhotos,
          video: payloadVideo,
        },
      }
    );

    if (error) {
      console.log("SUPABASE FUNCTION ERROR:", error);
      throw new Error(error.message || "SOS server upload failed.");
    }

    if (!data?.success) {
      console.log("SOS SERVER ERROR:", data);
      throw new Error(data?.error || "SOS server rejected the upload.");
    }

    console.log("SOS SERVER UPLOAD SUCCESS:", data);
    console.log("===== SOS SERVER UPLOAD COMPLETE =====");

    return data;
  };
  // Prepare and open the WhatsApp SOS message
  const sendWhatsAppSOS = async (
    location: Location.LocationObject | null,
    timestamp: string
  ) => {
    const latitude =
      location?.coords.latitude ?? 'Unavailable';

    const longitude =
      location?.coords.longitude ?? 'Unavailable';

    const mapsLink = location
      ? `https://www.google.com/maps?q=${latitude},${longitude}`
      : 'Location unavailable';

    const readableTime = new Date(timestamp).toLocaleString();

    const message = [
      '🚨 EMERGENCY ALERT — GoTogether SOS',
      '',
      `${userName} has triggered an SOS alert and may need immediate assistance.`,
      '',
      `📍 Current location: ${mapsLink}`,
      `🕒 Alert time: ${readableTime}`,
      '',
      `Emergency contact: ${contactName}`,
      '',
      'Please try calling immediately and help if needed.',
      '',
      'Evidence capture was attempted by the GoTogether SOS app. Media has not automatically been delivered through WhatsApp.',
    ].join('\n');

    const normalizedPhone = contactPhone.replace(/\D/g, '');
    const whatsappUrl =
      `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;

    try {
      await Linking.openURL(whatsappUrl);
      console.log('WHATSAPP SOS OPENED');
    } catch (error) {
      console.log('WHATSAPP OPEN ERROR:', error);
      Alert.alert('WhatsApp Error', 'Could not open WhatsApp.');
    }
  };

  // Capture four photos, then video/audio, location and backup
  const captureAllPhotos = async (
    timestamp: string,
    locationPromise: Promise<Location.LocationObject | null>
  ) => {
    if (captureRunningRef.current) {
      return;
    }

    captureRunningRef.current = true;
    setCapturing(true);
    setCameraError(null);

    try {
      console.log('===== SOS CAPTURE START =====');

      const sosId =
        sosIdRef.current ||
        `SOS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      sosIdRef.current = sosId;

      const nativeFolder =
        await createNativeEvidenceFolder(sosId);

      // Two photos from the back camera
      await waitForCameraReady();

      const backPhoto1 = await capturePhoto(
        'back_01.jpg',
        nativeFolder
      );

      if (!backPhoto1) {
        throw new Error('Back camera photo 1 failed.');
      }

      capturedPhotosRef.current.push(backPhoto1);
      console.log('BACK PHOTO 1 COMPLETE');

      await wait(500);

      const backPhoto2 = await capturePhoto(
        'back_02.jpg',
        nativeFolder
      );

      if (!backPhoto2) {
        throw new Error('Back camera photo 2 failed.');
      }

      capturedPhotosRef.current.push(backPhoto2);
      console.log('BACK PHOTO 2 COMPLETE');

      // Switch to the front camera
      cameraReadyRef.current = false;
      setCameraError(null);
      setFacing('front');

      await wait(Platform.OS === 'web' ? 1000 : 500);
      await waitForCameraReady();

      const frontPhoto1 = await capturePhoto(
        'front_01.jpg',
        nativeFolder
      );

      if (!frontPhoto1) {
        throw new Error('Front camera photo 1 failed.');
      }

      capturedPhotosRef.current.push(frontPhoto1);
      console.log('FRONT PHOTO 1 COMPLETE');

      await wait(500);

      const frontPhoto2 = await capturePhoto(
        'front_02.jpg',
        nativeFolder
      );

      if (!frontPhoto2) {
        throw new Error('Front camera photo 2 failed.');
      }

      capturedPhotosRef.current.push(frontPhoto2);
      console.log('FRONT PHOTO 2 COMPLETE');

      if (capturedPhotosRef.current.length !== 4) {
        throw new Error('Expected exactly 4 photos.');
      }

      console.log('PHOTO CHECK PASSED - 4 PHOTOS CAPTURED');

      // Record video and audio once
      await recordVideoAndAudio(nativeFolder);

      // Get GPS location
      const location = await locationPromise;
      console.log('LOCATION READY:', location?.coords);

      await saveLocationLocally(
        nativeFolder,
        location,
        timestamp
      );

      // A failed upload must not block the WhatsApp alert
      setServerUploadSucceeded(false);

      try {
        await uploadSOS(timestamp, location);
        setServerUploadSucceeded(true);
      } catch (uploadError) {
        console.log(
          'SERVER BACKUP FAILED; CONTINUING TO WHATSAPP ALERT:',
          uploadError
        );
      }

      await sendWhatsAppSOS(location, timestamp);

      console.log('===== SOS COMPLETE =====');
      setCapturing(false);
      setCompleted(true);
    } catch (error) {
      console.log('===== SOS ERROR =====', error);
      setCapturing(false);

      const message =
        error instanceof Error
          ? error.message
          : 'SOS evidence could not be completed.';

      setCameraError(message);

      if (Platform.OS !== 'web') {
        Alert.alert('SOS Error', message);
      }
    } finally {
      captureRunningRef.current = false;
      console.log('===== SOS CAPTURE END =====');
    }
  };

  // SOS button handler
  const handleSOS = async () => {
    if (
      !profileReady ||
      !userName.trim() ||
      !contactPhone.trim()
    ) {
      Alert.alert(
        'Complete setup first',
        'Save your name and emergency contact details before using SOS.'
      );
      return;
    }

    if (captureRunningRef.current) {
      return;
    }

    if (!permission?.granted) {
      const result = await requestPermission();

      if (!result.granted) {
        Alert.alert(
          'Camera Permission Required',
          'Camera access is required to activate SOS.'
        );
        return;
      }
    }

    // Reset evidence state for this SOS
    capturedPhotosRef.current = [];

    sosIdRef.current =
      `SOS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    cameraReadyRef.current = false;

    setCameraError(null);
    setFacing('back');
    setCompleted(false);
    setServerUploadSucceeded(false);
    setCapturing(false);
    setVideoUri(null);
    setAudioUri(null);

    const timestamp = new Date().toISOString();

    // Request GPS while the camera is opening
    const locationPromise =
      (async (): Promise<Location.LocationObject | null> => {
        try {
          const permissionResult =
            await Location.requestForegroundPermissionsAsync();

          if (permissionResult.status !== 'granted') {
            console.log('LOCATION PERMISSION NOT GRANTED');
            return null;
          }

          const location =
            await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.High,
            });

          console.log('GPS LATITUDE:', location.coords.latitude);
          console.log('GPS LONGITUDE:', location.coords.longitude);
          console.log('GPS ACCURACY:', location.coords.accuracy);

          return location;
        } catch (error) {
          console.log('LOCATION ERROR:', error);
          return null;
        }
      })();

    setCameraVisible(true);
    await wait(Platform.OS === 'web' ? 700 : 250);

    captureAllPhotos(timestamp, locationPromise);
  };
  // Camera screen
  if (cameraVisible) {
    return (
      <View style={styles.cameraContainer}>
        {Platform.OS === 'web' ? (
          <WebCamera
            ref={webCameraRef}
            facing={facing}
            onReady={() => {
              console.log('WEB CAMERA READY:', facing);
              cameraReadyRef.current = true;
              setCameraError(null);
            }}
            onError={(message) => {
              console.log('WEB CAMERA ERROR:', message);
              cameraReadyRef.current = false;
              setCameraError(message);
            }}
          />
        ) : (
          <CameraView
            ref={cameraRef}
            mode={videoMode ? 'video' : 'picture'}
            style={styles.camera}
            facing={facing}
            onCameraReady={() => {
              console.log('CAMERA READY:', facing, Platform.OS);
              cameraReadyRef.current = true;
              setCameraError(null);
            }}
            onMountError={(event) => {
              console.log('CAMERA MOUNT ERROR:', event.message);
              cameraReadyRef.current = false;
              setCameraError(
                event.message || 'The camera could not be started.'
              );
            }}
          />
        )}

        <View style={styles.cameraOverlay}>
          {!completed ? (
            <>
              <View style={styles.statusPill}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>SOS ACTIVATED</Text>
              </View>

              <Text style={styles.checkingMessage}>
                We're checking you.
              </Text>

              <View style={styles.liveCard}>
                <Text style={styles.liveTitle}>
                  GoTogether Safety
                </Text>
                <Text style={styles.liveSubtitle}>
                  Capturing your evidence and preparing your alert.
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
                <Text style={styles.successIcon}>✓</Text>
              </View>

              <Text style={styles.sosActive}>SOS ACTIVATED</Text>

              <Text style={styles.checkingMessage}>
                Capture process finished.
              </Text>

              <View style={styles.completedBox}>
                <Text style={styles.completedTitle}>
                  Capture process status
                </Text>

                <View style={styles.completedRow}>
                  <Text style={styles.checkmark}>✓</Text>
                  <Text style={styles.completedText}>
                    Four photos captured locally
                  </Text>
                </View>

                <View style={styles.completedRow}>
                  <Text style={styles.checkmark}>✓</Text>
                  <Text style={styles.completedText}>
                    Location saved locally when available
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
                    {serverUploadSucceeded
                      ? 'Server accepted the photo upload (photos only)'
                      : 'Server backup not confirmed; evidence remains local'}
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>
      </View>
    );
  }

  // Load saved profile
  if (!profileLoaded) {
    return (
      <View style={styles.container}>
        <Text style={styles.brand}>GoTogether</Text>
        <Text style={styles.description}>
          Loading your safety settings...
        </Text>
      </View>
    );
  }

  // Initial setup screen
  if (!profileReady) {
    return (
      <View style={styles.setupContainer}>
        <Text style={styles.brand}>GoTogether</Text>
        <Text style={styles.title}>SOS Setup</Text>

        <Text style={styles.setupDescription}>
          Add your details once. They stay on this device and are used
          to prepare your emergency WhatsApp message.
        </Text>

        <TextInput
          style={styles.input}
          value={userName}
          onChangeText={setUserName}
          placeholder="Your name"
          placeholderTextColor="#777777"
          autoCapitalize="words"
          returnKeyType="next"
        />

        <TextInput
          style={styles.input}
          value={contactName}
          onChangeText={setContactName}
          placeholder="Emergency contact name (e.g. Dad)"
          placeholderTextColor="#777777"
          autoCapitalize="words"
          returnKeyType="next"
        />

        <TextInput
          style={styles.input}
          value={contactPhone}
          onChangeText={setContactPhone}
          placeholder="WhatsApp number (10-digit India number or country code)"
          placeholderTextColor="#777777"
          keyboardType="phone-pad"
          autoCapitalize="none"
          returnKeyType="done"
        />

        <Pressable
          style={[
            styles.saveButton,
            profileSaving && styles.sosButtonDisabled,
          ]}
          onPress={saveProfile}
          disabled={profileSaving}
        >
          <Text style={styles.saveButtonText}>
            {profileSaving ? 'Saving...' : 'Save and continue'}
          </Text>
        </Pressable>

        <Text style={styles.helperText}>
          No account or login is required. WhatsApp will still require
          you to press Send.
        </Text>
      </View>
    );
  }

  // Safety Center
  return (
    <View style={styles.container}>
      <Text style={styles.brand}>GoTogether</Text>
      <Text style={styles.title}>Safety Center</Text>

      <Text style={styles.description}>
        If you feel unsafe during your journey, use the SOS button.
      </Text>

      <Text style={styles.profileSummary}>
        Ready for {userName}. Alert recipient: {contactName}
      </Text>

      <Pressable
        style={[
          styles.sosButton,
          capturing && styles.sosButtonDisabled,
        ]}
        onPress={handleSOS}
        disabled={capturing}
      >
        <Text style={styles.sosButtonText}>
          {capturing ? '...' : 'SOS'}
        </Text>
      </Pressable>

      <Text style={styles.helperText}>
        Captures four photos, attempts a five-second video and audio
        recording, records location, and opens WhatsApp with an alert
        message. Media is not automatically attached to WhatsApp.
      </Text>

      <Pressable
        style={styles.editProfileButton}
        onPress={() => setProfileReady(false)}
      >
        <Text style={styles.editProfileText}>
          Edit emergency contact
        </Text>
      </Pressable>
    </View>
  );
}

// Styles
const styles = StyleSheet.create({
  setupContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    padding: 24,
  },

  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 14,
    color: '#111111',
    fontSize: 15,
    marginBottom: 12,
    backgroundColor: '#ffffff',
  },

  setupDescription: {
    fontSize: 15,
    color: '#555555',
    lineHeight: 22,
    marginBottom: 22,
  },

  saveButton: {
    backgroundColor: '#1769ff',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 5,
  },

  saveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },

  profileSummary: {
    color: '#555555',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 18,
  },

  editProfileButton: {
    marginTop: 18,
    padding: 10,
  },

  editProfileText: {
    color: '#1769ff',
    fontWeight: '600',
    textAlign: 'center',
  },

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