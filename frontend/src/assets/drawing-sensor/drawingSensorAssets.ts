import { publicIconUrl } from '../../utils/publicIconUrl'

const icon = publicIconUrl

export const drawingSensorAssets = {
  imgAttachFileAdd: icon('attach-file-add.svg'),
  imgChevronLeft: icon('chevron-left.svg'),
  imgChevronRight: icon('chevron-right.svg'),
  imgSelectCaret: icon('select-caret.svg'),
  imgEdit: icon('edit-pen.svg'),
  imgDelete: icon('drawing-delete.svg'),
} as const
