import { FilesManager } from './files';
import { SchematicsManager } from './schematics';
import { Subject } from 'rxjs/Subject';
import defaultConfiguration from './config';

export interface AngularGUIApp {
  action: Subject<any>;
  config: typeof defaultConfiguration;
  files: FilesManager;
  logger;
  runner;
  schematics: SchematicsManager;
  initialize: (config: typeof defaultConfiguration) => Promise<void>;
  rebuild: () => Promise<void>;
}
