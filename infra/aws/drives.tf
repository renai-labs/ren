resource "aws_s3_bucket" "drives" {
  bucket = "${var.name}-drives-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "drives" {
  bucket                  = aws_s3_bucket.drives.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "drives" {
  bucket = aws_s3_bucket.drives.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_cors_configuration" "drives" {
  bucket = aws_s3_bucket.drives.id

  cors_rule {
    allowed_origins = ["https://${var.domain}"]
    allowed_methods = ["GET", "POST"]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

resource "aws_iam_role_policy" "server_task_drives" {
  name = "drives"
  role = aws_iam_role.server_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "s3:ListBucket", Resource = aws_s3_bucket.drives.arn },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.drives.arn}/*"
      },
    ]
  })
}
