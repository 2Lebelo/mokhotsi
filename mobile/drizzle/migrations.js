// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import m0000 from './20261006125759_init/migration.sql';
import m0001 from './20261008181158_outbox_rejections/migration.sql';

  export default {
    migrations: {
      "20261006125759_init": m0000,
"20261008181158_outbox_rejections": m0001
}
  }
  