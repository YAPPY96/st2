import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TouchableOpacity, Alert, Platform } from 'react-native';
import { useState, useEffect } from 'react';
import { Audio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';

export default function App() {
  const [recording, setRecording] = useState();
  const [sound, setSound] = useState();
  const [recordedUri, setRecordedUri] = useState(null);
  const [modelUri, setModelUri] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [permissionResponse, requestPermission] = Audio.usePermissions();

  useEffect(() => {
    return sound
      ? () => {
          console.log('Unloading Sound');
          sound.unloadAsync();
        }
      : undefined;
  }, [sound]);

  async function startRecording() {
    try {
      if (permissionResponse.status !== 'granted') {
        console.log('Requesting permission..');
        await requestPermission();
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      console.log('Starting recording..');
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
      console.log('Recording started');
    } catch (err) {
      console.error('Failed to start recording', err);
      Alert.alert('エラー', '録音を開始できませんでした');
    }
  }

  async function stopRecording() {
    if (!recording) return;

    console.log('Stopping recording..');
    setRecording(undefined);
    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    console.log('Recording stopped and stored at', uri);

    // ここで変換処理を行う想定
    // 現状は録音したファイルをそのままセットする
    setRecordedUri(uri);
    Alert.alert("変換完了", "音声の変換が完了しました（現在はダミー処理で、録音した音声をそのまま使用しています）");
  }

  async function playSound() {
    if (!recordedUri) return;
    console.log('Loading Sound');

    // 前の音が再生中なら停止・アンロード
    if (sound) {
        await sound.unloadAsync();
    }

    const { sound: newSound } = await Audio.Sound.createAsync({ uri: recordedUri });
    setSound(newSound);

    console.log('Playing Sound');
    await newSound.playAsync();
  }

  async function pickModel() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*', // 必要に応じて拡張子を制限 (.tflite, .pt など)
        copyToCacheDirectory: true
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setModelUri(result.assets[0].uri);
        Alert.alert("モデル選択", `選択されたモデル: ${result.assets[0].name}`);
      }
    } catch (err) {
      console.log('Document picker error:', err);
    }
  }

  async function downloadSound() {
    if (!recordedUri) {
      Alert.alert("エラー", "保存する音声がありません");
      return;
    }

    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(recordedUri);
      } else {
        Alert.alert("エラー", "このデバイスでは共有機能が利用できません");
      }
    } else {
        Alert.alert("注意", "Web版ではダウンロード機能の実装が異なります");
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AI Voice Changer</Text>

      <View style={styles.modelSection}>
        <Text style={styles.label}>AIモデル:</Text>
        <TouchableOpacity style={styles.button} onPress={pickModel}>
          <Text style={styles.buttonText}>
            {modelUri ? "モデルを変更" : "モデルを選択 (Androidフォルダ)"}
          </Text>
        </TouchableOpacity>
        {modelUri && <Text style={styles.smallText}>選択済み</Text>}
      </View>

      <View style={styles.recordSection}>
        <Text style={styles.instruction}>マイクボタンを長押しして録音・変換</Text>
        <TouchableOpacity
          style={[styles.recordButton, isRecording && styles.recordingButton]}
          onPressIn={startRecording}
          onPressOut={stopRecording}
        >
          <Text style={styles.recordButtonText}>{isRecording ? "録音中..." : "🎙️"}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.playbackSection}>
        <TouchableOpacity
          style={[styles.actionButton, !recordedUri && styles.disabledButton]}
          onPress={playSound}
          disabled={!recordedUri}
        >
          <Text style={styles.actionButtonText}>▶ 再生</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, !recordedUri && styles.disabledButton]}
          onPress={downloadSound}
          disabled={!recordedUri}
        >
          <Text style={styles.actionButtonText}>⬇ 保存/共有</Text>
        </TouchableOpacity>
      </View>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 40,
  },
  modelSection: {
    marginBottom: 40,
    alignItems: 'center',
    width: '100%',
  },
  label: {
    fontSize: 16,
    marginBottom: 10,
  },
  button: {
    backgroundColor: '#2196F3',
    padding: 10,
    borderRadius: 5,
    width: '80%',
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
  },
  smallText: {
    fontSize: 12,
    color: 'gray',
    marginTop: 5,
  },
  recordSection: {
    marginBottom: 40,
    alignItems: 'center',
  },
  instruction: {
    marginBottom: 20,
    fontSize: 14,
    color: '#666',
  },
  recordButton: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  recordingButton: {
    backgroundColor: '#ff4444',
  },
  recordButtonText: {
    fontSize: 16, // 少し小さく
    textAlign: 'center',
  },
  playbackSection: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  actionButton: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 5,
    minWidth: 100,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  actionButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
