// `.sql` files are inlined as strings by babel-plugin-inline-import (see babel.config.js).
declare module '*.sql' {
  const sql: string;
  export default sql;
}
