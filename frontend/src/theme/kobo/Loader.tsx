import { Loader } from '@mantine/core'

// For the minimal POC, we use Mantine's default loaders
// The original KoboToolbox uses custom LoadingSpinner components
export const LoaderThemeKobo = Loader.extend({
  defaultProps: {
    type: 'dots',
    color: 'blue',
  },
})
