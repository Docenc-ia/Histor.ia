/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Disposition & Attendance History Domain Repository.
 */

import { StudentHistoryItem, StudentDispositionData } from '../../types';
import {
  api,
  getAllDispositionStorage,
  saveAllDispositionStorage,
  getLocalDisposition2c,
  saveLocalDisposition2c,
} from '../api';

export const dispositionRepository = {
  getAllLocal: getAllDispositionStorage,
  saveAllLocal: saveAllDispositionStorage,
  getLocal2c: getLocalDisposition2c,
  saveLocal2c: saveLocalDisposition2c,
  fetchCloudDisposition: (): Promise<{
    disposition: Record<string, StudentDispositionData>;
    history: StudentHistoryItem[];
  }> => api.getDispositionData(),
};
