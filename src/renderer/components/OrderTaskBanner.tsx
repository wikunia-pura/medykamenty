import React from 'react';
import type { TaskStatus } from '../../shared/types';
import { useT } from '../i18n';
import { IconCheck, IconChevronLeft } from './Icons';

interface Props {
  orderName: string;
  taskStatus: TaskStatus;
  onBackToOrder: () => void;
  onMarkDone: () => void | Promise<void>;
  onReopen: () => void | Promise<void>;
}

// Shown above the screen the user navigated to from a workflow task. Gives them
// the two actions they can take in that context: bail out, or mark the task done.
const OrderTaskBanner: React.FC<Props> = ({
  orderName,
  taskStatus,
  onBackToOrder,
  onMarkDone,
  onReopen,
}) => {
  const t = useT();
  const isDone = taskStatus === 'done';
  return (
    <div className="order-task-banner">
      <div className="order-task-banner-text">
        <strong>{isDone ? t.taskAlreadyDoneNote : t.taskInProgressNote}</strong>
        <span className="order-task-banner-order">{orderName}</span>
      </div>
      <div className="order-task-banner-actions">
        <button type="button" className="btn btn-sm" onClick={onBackToOrder}>
          <IconChevronLeft size={12} /> {t.backToOrder}
        </button>
        {isDone ? (
          <button type="button" className="btn btn-sm" onClick={() => void onReopen()}>
            ↺ {t.reopenTask}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void onMarkDone()}
          >
            <IconCheck size={12} /> {t.markTaskDone}
          </button>
        )}
      </div>
    </div>
  );
};

export default OrderTaskBanner;
