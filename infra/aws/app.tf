# The web app: a static build in a private bucket behind CloudFront, served under /app/.

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

# `/` goes to the app. A path under /app/ without a file extension is a client route, so it gets the
# app's index; a path with one is a file and goes to the bucket.
resource "aws_cloudfront_function" "app" {
  name    = "${var.name}-app"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOF
    function handler(event) {
      var request = event.request
      var uri = request.uri
      if (uri === "/" || uri === "/app") {
        return { statusCode: 301, statusDescription: "Moved Permanently", headers: { location: { value: "/app/" } } }
      }
      if (uri.startsWith("/app/") && uri.split("/").pop().indexOf(".") === -1) {
        request.uri = "/app/index.html"
      }
      return request
    }
  EOF
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
