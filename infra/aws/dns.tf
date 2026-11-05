data "aws_route53_zone" "preview" {
  name = local.preview_domain
}

resource "aws_acm_certificate" "preview" {
  provider          = aws.us_east_1
  domain_name       = "*.${local.preview_domain}"
  key_algorithm     = "EC_prime256v1"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "preview_certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.preview.domain_validation_options :
    option.domain_name => option
  }

  zone_id = data.aws_route53_zone.preview.zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  ttl     = 300
  records = [each.value.resource_record_value]
}

resource "aws_acm_certificate_validation" "preview" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.preview.arn
  validation_record_fqdns = [for record in aws_route53_record.preview_certificate_validation : record.fqdn]
}

resource "aws_route53_record" "preview" {
  for_each = toset(["A", "AAAA"])
  zone_id  = data.aws_route53_zone.preview.zone_id
  name     = "*.${local.preview_domain}"
  type     = each.value

  alias {
    name                   = aws_cloudfront_distribution.preview.domain_name
    zone_id                = aws_cloudfront_distribution.preview.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "preview_auth" {
  for_each = toset(["A", "AAAA"])
  zone_id  = data.aws_route53_zone.preview.zone_id
  name     = local.sign_in_host
  type     = each.value

  alias {
    name                   = aws_cloudfront_distribution.preview_auth.domain_name
    zone_id                = aws_cloudfront_distribution.preview_auth.hosted_zone_id
    evaluate_target_health = false
  }
}
