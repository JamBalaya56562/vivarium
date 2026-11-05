locals {
  preview_host_header = "x-vivarium-host"
  cloudfront_invoke_policies = {
    for name, origin in {
      proxy = { endpoint = aws_lambdaweb_function_endpoint.preview_proxy, distribution = aws_cloudfront_distribution.preview }
      auth  = { endpoint = aws_lambdaweb_function_endpoint.preview_auth, distribution = aws_cloudfront_distribution.preview_auth }
      } : name => jsonencode({
        Version = "2012-10-17"
        Statement = [{
          Sid       = "CloudFrontOnly"
          Effect    = "Allow"
          Principal = { Service = "cloudfront.amazonaws.com" }
          Action    = "lambda:InvokeWebFunctionEndpoint"
          Resource  = origin.endpoint.arn
          Condition = { StringEquals = { "aws:SourceArn" = origin.distribution.arn } }
        }]
    })
  }
}

resource "aws_cloudfront_origin_access_control" "preview" {
  name                              = "vivarium-preview"
  description                       = "Signs the requests to the preview Web Functions."
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always-amz-auth"
  signing_protocol                  = "sigv4"
}

# The Web Function's endpoint answers only its own Host, so the viewer's reaches
# the proxy in a header this function overwrites, which a viewer cannot forge.
resource "aws_cloudfront_function" "preview_host" {
  name    = "vivarium-preview-host"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      request.headers['${local.preview_host_header}'] = { value: request.headers.host.value };
      return request;
    }
  EOT
}

# CloudFront drops Authorization from a GET unless the cache policy names it, and
# a policy that names headers needs a TTL above zero. Every value the response
# depends on is in the key, so a cached answer never crosses a preview or a session.
resource "aws_cloudfront_cache_policy" "preview" {
  name        = "vivarium-preview"
  comment     = "Forwards Authorization; nothing outlives a second or crosses a preview or session."
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 1

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "all"
    }
    query_strings_config {
      query_string_behavior = "all"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["authorization", local.preview_host_header]
      }
    }
  }
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_distribution" "preview" {
  comment         = "The previews, one host each."
  aliases         = ["*.${local.preview_domain}"]
  enabled         = true
  http_version    = "http2and3"
  is_ipv6_enabled = true
  price_class     = "PriceClass_200"

  origin {
    origin_id                = "proxy"
    domain_name              = aws_lambdaweb_function_endpoint.preview_proxy.domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.preview.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  default_cache_behavior {
    target_origin_id         = "proxy"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.preview.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.preview_host.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.preview.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

resource "aws_cloudfront_distribution" "preview_auth" {
  comment         = "The GitHub sign-in for the previews."
  aliases         = [local.sign_in_host]
  enabled         = true
  http_version    = "http2and3"
  is_ipv6_enabled = true
  price_class     = "PriceClass_200"

  origin {
    origin_id                = "auth"
    domain_name              = aws_lambdaweb_function_endpoint.preview_auth.domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.preview.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id         = "auth"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.preview.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
