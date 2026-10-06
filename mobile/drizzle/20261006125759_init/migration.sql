CREATE TABLE `embeddings` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL,
	`vector` blob NOT NULL,
	`dim` integer NOT NULL,
	`model_version` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_embeddings_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
);
--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`value_ms` real NOT NULL,
	`meta` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`op_id` text PRIMARY KEY,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`op` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL,
	`local_uri` text NOT NULL,
	CONSTRAINT `fk_product_images_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY,
	`shop_id` text NOT NULL,
	`name` text NOT NULL,
	`price_cents` integer NOT NULL,
	`barcode` text,
	`updated_at` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` text PRIMARY KEY,
	`sale_id` text NOT NULL,
	`product_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`match_score` real,
	`match_method` text NOT NULL,
	CONSTRAINT `fk_sale_items_sale_id_sales_id_fk` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`),
	CONSTRAINT `fk_sale_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY,
	`shop_id` text NOT NULL,
	`total_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	`device_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `embeddings_product_idx` ON `embeddings` (`product_id`);--> statement-breakpoint
CREATE INDEX `embeddings_model_idx` ON `embeddings` (`model_version`);--> statement-breakpoint
CREATE INDEX `metrics_kind_created_idx` ON `metrics` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `outbox_created_idx` ON `outbox` (`created_at`);--> statement-breakpoint
CREATE INDEX `product_images_product_idx` ON `product_images` (`product_id`);--> statement-breakpoint
CREATE INDEX `products_shop_updated_idx` ON `products` (`shop_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `products_shop_barcode_idx` ON `products` (`shop_id`,`barcode`);--> statement-breakpoint
CREATE INDEX `sale_items_sale_idx` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `sale_items_product_idx` ON `sale_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `sales_shop_created_idx` ON `sales` (`shop_id`,`created_at`);