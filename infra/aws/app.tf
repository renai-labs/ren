# The site and the web app: static builds in a private bucket behind CloudFront. The site's files sit
# at the bucket's root and the app's under /app/; both serve pages at the root of the domain.

resource "aws_s3_bucket" "app" {
  bucket = "${var.name}-app-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket                  = aws_s3_bucket.app.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "app" {
  bucket = aws_s3_bucket.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.app.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.app.arn } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.app]
}

resource "aws_cloudfront_origin_access_control" "app" {
  name                              = "${var.name}-app"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# /install is the CLI installer, /ren/install.sh. A path under /ren/ (CLI releases) or with a file
# extension is a file and goes to the bucket; the app's files sit under /app/. The app's pages are at the root, so any other path under /app is an old
# link: it redirects to the same page without /app and sets the signed-in hint, because whoever opens it
# wants the app. A site section gets that directory's index and /home the landing page. / gets the app
# when the app has set the hint cookie and the landing page when it has not. Every other path is a page
# of the app.
resource "aws_cloudfront_function" "app" {
  name    = "${var.name}-app"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/app-function.js")
}

resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name} app"
  aliases         = [var.domain]
  http_version    = "http2"
  price_class     = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.app.bucket_regional_domain_name
    origin_id                = "app"
    origin_access_control_id = aws_cloudfront_origin_access_control.app.id
  }

  default_cache_behavior {
    target_origin_id       = "app"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # Managed-CachingOptimized. The deploy sets no-cache on index.html and a year on hashed assets.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.app.arn
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.this.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}
