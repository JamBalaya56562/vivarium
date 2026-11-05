locals {
  access = jsondecode(file("${local.recipes_dir}/access.json"))
}

resource "random_password" "preview_session" {
  length  = 64
  special = false
}

data "archive_file" "preview_auth" {
  type        = "zip"
  output_path = "${path.module}/.build/preview-auth.zip"
  dynamic "source" {
    for_each = ["auth-server.mjs", "auth.mjs", "http.mjs", "session.mjs"]
    content {
      filename = source.value
      content  = file("${path.module}/preview-proxy/${source.value}")
    }
  }
}

resource "aws_s3_object" "preview_auth" {
  bucket = aws_s3_bucket.artifacts.id
  key    = "${local.web_function_artifacts}/auth-${data.archive_file.preview_auth.output_sha256}.zip"
  source = data.archive_file.preview_auth.output_path

  lifecycle {
    create_before_destroy = true
  }
}

# Lambda writes logs to the .local group first, then copies them to the other; it would create it with no retention.
resource "aws_cloudwatch_log_group" "preview_auth" {
  for_each          = toset(["/vivarium/preview-auth", "/vivarium/preview-auth.local"])
  name              = each.value
  retention_in_days = 30
}

moved {
  from = aws_cloudwatch_log_group.preview_auth
  to   = aws_cloudwatch_log_group.preview_auth["/vivarium/preview-auth"]
}

resource "aws_iam_role" "preview_auth" {
  name                 = "vivarium-preview-auth"
  description          = "Signs reviewers in to the previews with GitHub."
  permissions_boundary = aws_iam_policy.workload_boundary.arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "preview_auth" {
  name = "preview-auth"
  role = aws_iam_role.preview_auth.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = [for group in aws_cloudwatch_log_group.preview_auth : "${group.arn}:*"]
    }]
  })
}

resource "aws_lambdaweb_function" "preview_auth" {
  function_name = "vivarium-preview-auth"
}

resource "aws_lambdaweb_function_revision" "preview_auth" {
  function_name = aws_lambdaweb_function.preview_auth.function_name
  description   = "Signs reviewers in to the previews with GitHub."

  build_config {
    runtime_config {
      runtime = "nodejs24.x"
    }
    code_config {
      s3_object {
        bucket     = aws_s3_object.preview_auth.bucket
        key        = aws_s3_object.preview_auth.key
        version_id = aws_s3_object.preview_auth.version_id
      }
    }
  }

  service_config {
    execution_role_arn = aws_iam_role.preview_auth.arn
    timeout_seconds    = 15
    environment_variables = {
      AWS_LAMBDA_NODEJS_ENTRYPOINT = "auth-server.mjs"
      CLIENT_ID                    = var.preview_github_client_id
      CLIENT_SECRET                = var.preview_github_client_secret
      SESSION_KEY                  = random_password.preview_session.result
      SIGN_IN_URL                  = "https://${local.sign_in_host}"
      PREVIEWS = jsonencode({
        for name, preview in local.previews : name => {
          url        = "https://${name}.${local.preview_domain}"
          repository = preview.repository
          pull       = preview.pull
          commit     = preview.commit
          allowed = distinct(concat(
            local.access.all_previews,
            try(local.access.repositories[preview.repository], []),
            try(preview.access, []),
          ))
        }
      })
    }
    telemetry_config {
      logging_config {
        log_group = aws_cloudwatch_log_group.preview_auth["/vivarium/preview-auth"].name
      }
    }
  }

  depends_on = [aws_iam_role_policy.preview_auth, aws_s3_bucket_policy.artifacts]

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lambdaweb_function_endpoint" "preview_auth" {
  function_name        = aws_lambdaweb_function.preview_auth.function_name
  endpoint_name        = "cloudfront"
  endpoint_type        = "HomeRegion"
  auth_type            = "IamAuth"
  auto_deployment_mode = "Disabled"

  revision_weight {
    revision_id = aws_lambdaweb_function_revision.preview_auth.revision_id
    weight      = 100
  }
}

resource "aws_lambdaweb_resource_policy" "preview_auth" {
  resource_arn = aws_lambdaweb_function.preview_auth.arn
  policy       = local.cloudfront_invoke_policies.auth
}

output "preview_sign_in_callback" {
  description = "The callback URL the GitHub OAuth app for the previews must name"
  value       = "https://${local.sign_in_host}/callback"
}
