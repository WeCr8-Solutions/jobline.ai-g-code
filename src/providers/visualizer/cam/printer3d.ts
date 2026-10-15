// File-based integration: reads posted NC output and exported setup sheets
// from a folder. No live link to the vendor application (see CAM_SYSTEMS).
import { FolderCamConnection, CamFolderIO, nodeFolderIO } from '../../../cam/folderConnection';

export class Printer3DConnection extends FolderCamConnection {
  constructor(folder = '', io: CamFolderIO = nodeFolderIO) { super('slicer', folder, io); }
}
