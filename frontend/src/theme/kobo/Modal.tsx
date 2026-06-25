import { Modal } from '@mantine/core'
import classes from './Modal.module.css'

export const ModalThemeKobo = Modal.extend({
  defaultProps: {
    // Using default Mantine close button for minimal POC
    // Original KoboToolbox uses custom Icon component
    overlayProps: {
      backgroundOpacity: 0.5,
      color: 'var(--mantine-color-blue-9)',
      zIndex: 3000,
    },
    zIndex: 4000,
    padding: 'lg',
  },
  classNames: classes,
})
