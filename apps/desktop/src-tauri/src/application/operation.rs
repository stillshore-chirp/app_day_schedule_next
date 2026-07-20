use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use tokio::sync::Mutex;
use uuid::Uuid;

use crate::domain::{AppError, AppResult};

#[derive(Clone, Default)]
pub struct OperationCancellation {
    cancelled: Arc<AtomicBool>,
}

impl OperationCancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn check(&self) -> AppResult<()> {
        if self.is_cancelled() {
            return Err(AppError::Cancelled {
                message: "操作を取り消しました。".into(),
                recovery:
                    "確定済みの処理は保持されています。必要な場合はもう一度開始してください。"
                        .into(),
            });
        }
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct OperationRegistry {
    active: Arc<Mutex<HashMap<Uuid, OperationCancellation>>>,
}

impl OperationRegistry {
    pub async fn begin(&self, operation_id: Uuid) -> AppResult<OperationCancellation> {
        let mut active = self.active.lock().await;
        if active.contains_key(&operation_id) {
            return Err(AppError::Conflict {
                message: "同じ操作IDがすでに実行中です。".into(),
                recovery: "現在の操作が終わってから、もう一度開始してください。".into(),
            });
        }
        let cancellation = OperationCancellation::default();
        active.insert(operation_id, cancellation.clone());
        Ok(cancellation)
    }

    pub async fn cancel(&self, operation_id: Uuid) -> bool {
        let active = self.active.lock().await;
        let Some(cancellation) = active.get(&operation_id) else {
            return false;
        };
        cancellation.cancel();
        true
    }

    pub async fn finish(&self, operation_id: Uuid) {
        self.active.lock().await.remove(&operation_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_is_scoped_and_removed_after_finish() {
        let registry = OperationRegistry::default();
        let first_id = Uuid::new_v4();
        let second_id = Uuid::new_v4();
        let first = registry.begin(first_id).await.unwrap();
        let second = registry.begin(second_id).await.unwrap();

        assert!(registry.cancel(first_id).await);
        assert!(matches!(first.check(), Err(AppError::Cancelled { .. })));
        assert!(second.check().is_ok());

        registry.finish(first_id).await;
        assert!(!registry.cancel(first_id).await);
        assert!(registry.begin(first_id).await.is_ok());
    }
}
