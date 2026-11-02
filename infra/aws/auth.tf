locals {
  access             = jsondecode(file("${local.recipes_dir}/access.json"))
  preview_auth_index = "preview-auth/previews.json"
}

resource "random_password" "preview_session" {
  length  = 64
  special = false
}

resource "aws_s3_object" "preview_auth_previews" {
  bucket       = aws_s3_bucket.artifacts.id
  key          = local.preview_auth_index
  content_type = "application/json"
  content = jsonencode({
    for name, preview in local.previews : name => {
      url        = aws_lambda_function_url.preview[name].function_url
      repository = preview.repository
      pull       = preview.pull
      allowed = distinct(concat(
        local.access.all_previews,
        try(local.access.repositories[preview.repository], []),
        try(preview.access, []),
      ))
    }
  })
}

data "archive_file" "preview_auth" {
  type        = "zip"
  output_path = "${path.module}/.build/preview-auth.zip"
  source {
    filename = "auth.mjs"
    content  = file("${path.module}/preview-proxy/auth.mjs")
  }
  source {
    filename = "session.mjs"
    content  = file("${path.module}/preview-proxy/session.mjs")
  }
}

resource "aws_cloudwatch_log_group" "preview_auth" {
  name              = "/vivarium/preview-auth"
  retention_in_days = 30
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
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.artifacts.arn}/${local.preview_auth_index}"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.preview_auth.arn}:*"
      },
    ]
  })
}

resource "aws_lambda_function" "preview_auth" {
  function_name    = "vivarium-preview-auth"
  description      = "Signs reviewers in to the previews with GitHub."
  role             = aws_iam_role.preview_auth.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "auth.handler"
  filename         = data.archive_file.preview_auth.output_path
  source_code_hash = data.archive_file.preview_auth.output_base64sha256
  memory_size      = 256
  timeout          = 15
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.preview_auth.name
  }
  environment {
    variables = {
      CLIENT_ID       = var.preview_github_client_id
      CLIENT_SECRET   = var.preview_github_client_secret
      SESSION_KEY     = random_password.preview_session.result
      PREVIEWS_BUCKET = aws_s3_bucket.artifacts.id
      PREVIEWS_KEY    = local.preview_auth_index
    }
  }

  depends_on = [aws_iam_role_policy.preview_auth]
}

resource "aws_lambda_function_url" "preview_auth" {
  function_name      = aws_lambda_function.preview_auth.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "preview_auth_url" {
  statement_id           = "public-function-url"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.preview_auth.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "preview_auth_invoke" {
  statement_id             = "public-function-url-invoke"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.preview_auth.function_name
  principal                = "*"
  invoked_via_function_url = true
}

output "preview_sign_in_callback" {
  description = "The callback URL the GitHub OAuth app for the previews must name"
  value       = "${aws_lambda_function_url.preview_auth.function_url}callback"
}
