ALTER TABLE `outbox` ADD `rejected_reason` text;--> statement-breakpoint
ALTER TABLE `outbox` ADD `rejected_at` integer;--> statement-breakpoint
CREATE INDEX `outbox_entity_idx` ON `outbox` (`entity`,`entity_id`);