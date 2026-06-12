ALTER TABLE `job_postings` ADD `trait_profile` text;--> statement-breakpoint
UPDATE `job_postings` SET `trait_profile` = (
  SELECT json_extract(o.`culture_fit_profile`, '$.traitProfile')
  FROM `organizations` o WHERE o.`id` = `job_postings`.`org_id`
) WHERE `org_id` IS NOT NULL;