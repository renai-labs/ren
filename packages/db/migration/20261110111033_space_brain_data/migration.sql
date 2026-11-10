-- Custom SQL migration file, put your code below! --
UPDATE "space" SET "brain_template_id" = "environment_template_id", "environment_template_id" = NULL WHERE "hand_placement" = 'colocated' AND "environment_template_id" IS NOT NULL;
