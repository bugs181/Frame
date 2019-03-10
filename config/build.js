// Rollup plugins
import { eslint } from 'rollup-plugin-eslint'
import filesize from 'rollup-plugin-filesize'

function onwarn(warning) {
  if (warning.code !== 'CIRCULAR_DEPENDENCY') {
    // eslint-disable-next-line no-console
    console.error(`(!) ${warning.message}`)
  }
}

export default {
  onwarn,
  input: 'lib/index.js',
  output: {
    file: 'build/frame.js',
    format: 'iife',

    exports: 'none',

    sourcemap: 'inline',
    freeze: false,
    preferConst: true,
  },

  plugins: [
    eslint('config/dev.eslintrc.js'),
    filesize({ showMinifiedSize: false }),
  ],
}
