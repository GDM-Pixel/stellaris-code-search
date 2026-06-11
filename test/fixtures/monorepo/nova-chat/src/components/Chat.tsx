import { fetchTasks } from '@/services/todoist';
import { ConfirmDialog } from '@/components/ui';

export function Chat() {
  fetchTasks();
  return ConfirmDialog();
}
