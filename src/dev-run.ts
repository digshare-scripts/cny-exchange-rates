import {devRun} from '@digshare/script';

import script from './script';

void devRun(script, {
  storage: {
    // dailySent: new Date().toDateString(),
    rates: {
      美元: 6.3,
    },
  },
});
