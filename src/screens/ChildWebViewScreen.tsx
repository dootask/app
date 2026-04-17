import React from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { WebViewHost } from './WebViewHost';
import { onChildPageClosed } from '../bridge/handlers/navigation';
import type { RootStackParamList } from '../navigation/types';

type ChildRoute = RouteProp<RootStackParamList, 'ChildWebView'>;

export function ChildWebViewScreen() {
  const route = useRoute<ChildRoute>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { url, title, pageId } = route.params;

  React.useEffect(() => {
    return () => {
      onChildPageClosed(pageId);
    };
  }, [pageId]);

  return (
    <WebViewHost
      url={url}
      isFirstPage={false}
      pageId={pageId}
      navigation={navigation}
      showHeader
      headerTitle={title}
    />
  );
}
