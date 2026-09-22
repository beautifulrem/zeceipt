-- Custom migration (drizzle-kit generate --custom): a batch and its items are frozen once a submission
-- exists for the batch, so the stored batch always states exactly what was paid. Drizzle's schema API has
-- no triggers, hence hand-written SQL. Each trigger aborts the whole statement (SQLITE_CONSTRAINT_TRIGGER).
CREATE TRIGGER `batch_items_frozen_insert` BEFORE INSERT ON `batch_items`
WHEN EXISTS (SELECT 1 FROM `submissions` s WHERE s.`org_id` = NEW.`org_id` AND s.`batch_id` = NEW.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'batch is frozen: a submission exists'); END;
--> statement-breakpoint
CREATE TRIGGER `batch_items_frozen_update` BEFORE UPDATE ON `batch_items`
WHEN EXISTS (SELECT 1 FROM `submissions` s WHERE (s.`org_id` = OLD.`org_id` AND s.`batch_id` = OLD.`batch_id`) OR (s.`org_id` = NEW.`org_id` AND s.`batch_id` = NEW.`batch_id`))
BEGIN SELECT RAISE(ABORT, 'batch is frozen: a submission exists'); END;
--> statement-breakpoint
CREATE TRIGGER `batch_items_frozen_delete` BEFORE DELETE ON `batch_items`
WHEN EXISTS (SELECT 1 FROM `submissions` s WHERE s.`org_id` = OLD.`org_id` AND s.`batch_id` = OLD.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'batch is frozen: a submission exists'); END;
--> statement-breakpoint
CREATE TRIGGER `batches_frozen_update` BEFORE UPDATE ON `batches`
WHEN EXISTS (SELECT 1 FROM `submissions` s WHERE s.`org_id` = OLD.`org_id` AND s.`batch_id` = OLD.`id`)
BEGIN SELECT RAISE(ABORT, 'batch is frozen: a submission exists'); END;
--> statement-breakpoint
CREATE TRIGGER `batches_frozen_delete` BEFORE DELETE ON `batches`
WHEN EXISTS (SELECT 1 FROM `submissions` s WHERE s.`org_id` = OLD.`org_id` AND s.`batch_id` = OLD.`id`)
BEGIN SELECT RAISE(ABORT, 'batch is frozen: a submission exists'); END;
