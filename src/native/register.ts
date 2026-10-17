import { Platform } from 'react-native';

import { getLegacyStoreModule } from '../../modules/legacy-store';
import { registerModule } from '../bridge/dispatcher';
import type { PageHandle } from '../bridge/pages';

registerModule('eeui', {
  goDesktop(_page: PageHandle) {
    if (Platform.OS === 'android') return getLegacyStoreModule().moveTaskToBack();
  },
});
