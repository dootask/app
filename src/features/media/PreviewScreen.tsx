import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { VideoView, useVideoPlayer } from 'expo-video';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PictureRequest } from './requests';
import { mediaStrings } from './strings';
import { closeMediaRoute, useMediaActive, useMediaRoute } from './useMediaRoute';
import ZoomableImage from './ZoomableImage';
import type { Size } from './zoom';

function PicturePreview({ request }: { request: PictureRequest }) {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [position, setPosition] = useState(request.position);
  const [pagingEnabled, setPagingEnabled] = useState(true);
  const onZoomChange = useCallback((zoomed: boolean) => setPagingEnabled(!zoomed), []);
  const strings = mediaStrings(request.language);

  return (
    <>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" hitSlop={12} onPress={closeMediaRoute}>
          <Text style={styles.button}>{strings.close}</Text>
        </Pressable>
        <Text style={styles.text} accessibilityLiveRegion="polite">{position + 1} / {request.paths.length}</Text>
      </View>
      <View style={styles.content} onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setViewport((previous) => previous.width === width && previous.height === height ? previous : { width, height });
        setPagingEnabled(true);
      }}>
        {viewport.width > 0 && viewport.height > 0 && (
          <FlatList
            // 旋转时重建布局，初始索引取当前图，避免沿用旧页面宽度的偏移量。
            key={`${viewport.width}:${viewport.height}`}
            data={request.paths} horizontal pagingEnabled scrollEnabled={pagingEnabled}
            initialScrollIndex={position} initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3}
            showsHorizontalScrollIndicator={false} bounces={false} removeClippedSubviews={false}
            keyExtractor={(_item, index) => String(index)}
            getItemLayout={(_data, index) => ({ length: viewport.width, offset: viewport.width * index, index })}
            onMomentumScrollEnd={(event) => {
              const index = Math.max(0, Math.min(request.paths.length - 1, Math.round(event.nativeEvent.contentOffset.x / viewport.width)));
              setPosition(index);
              setPagingEnabled(true);
            }}
            renderItem={({ item, index }) => (
              <ZoomableImage key={`${index}:${position === index}`} uri={item} viewport={viewport} active={position === index} onZoomChange={onZoomChange} strings={strings} />
            )}
          />
        )}
      </View>
    </>
  );
}

function VideoPreview({ path, language }: { path: string; language: string }) {
  const active = useMediaActive();
  const resume = useRef(false);
  const player = useVideoPlayer(path, (instance) => {
    instance.loop = false;
    instance.staysActiveInBackground = false;
    if (Platform.OS === 'android') instance.play();
  });
  const [status, setStatus] = useState(player.status);
  const strings = mediaStrings(language);

  useEffect(() => {
    const subscription = player.addListener('statusChange', (event) => setStatus(event.status));
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    if (active) {
      if (resume.current) player.play();
    } else {
      resume.current = player.playing;
      player.pause();
    }
  }, [active, player]);

  return (
    <>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" hitSlop={12} onPress={closeMediaRoute}>
          <Text style={styles.button}>{strings.close}</Text>
        </Pressable>
      </View>
      <View style={styles.content}>
        <VideoView
          player={player} style={styles.content} nativeControls contentFit="contain"
          fullscreenOptions={{ enable: false }} allowsPictureInPicture={false}
        />
        {status === 'loading' && <ActivityIndicator pointerEvents="none" style={styles.indicator} color="#fff" />}
        {status === 'error' && <View pointerEvents="none" style={styles.error}><Text style={styles.text}>{strings.videoFailed}</Text></View>}
      </View>
    </>
  );
}

export default function PreviewScreen() {
  const handle = useMediaRoute();
  const request = handle?.request;
  const strings = mediaStrings(request && 'language' in request ? request.language : '');
  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
      <StatusBar style="light" />
      {request?.kind === 'pictures' ? <PicturePreview request={request} />
        : request?.kind === 'video' ? <VideoPreview path={request.path} language={request.language} />
          : <View style={styles.error}>
            <Text style={styles.text}>{strings.expired}</Text>
            <Pressable accessibilityRole="button" onPress={closeMediaRoute}><Text style={styles.button}>{strings.close}</Text></Pressable>
          </View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  button: { color: '#fff', fontSize: 16, paddingVertical: 12 },
  text: { color: '#fff', fontSize: 16 },
  content: { flex: 1 },
  indicator: { position: 'absolute', alignSelf: 'center', top: '48%' },
  error: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 16 },
});
