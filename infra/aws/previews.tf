locals {
  recipes_dir    = "${path.module}/../../src/layer3_previews"
  preview_domain = jsondecode(file("${local.recipes_dir}/domain.json")).domain
  sign_in_host   = "sign-in.${local.preview_domain}"
  previews = {
    for recipe in fileset(local.recipes_dir, "*/preview.json") :
    dirname(recipe) => merge(
      { pull = null, source = null, public = [] },
      jsondecode(file("${local.recipes_dir}/${recipe}")),
    )
  }
  preview_labels = {
    for name, preview in local.previews :
    name => preview.pull == null ? "${coalesce(preview.source, preview.repository)} at ${preview.commit}" : "${preview.repository}#${preview.pull} at ${preview.commit}"
  }

  account_id         = data.aws_caller_identity.current.account_id
  base_image_arn     = "arn:aws:lambda:${var.aws_region}:aws:microvm-image:al2023-1"
  base_image_version = "2"
  connector          = "arn:aws:lambda:${var.aws_region}:aws:network-connector:aws-network-connector"
  motioneye_files    = ["entrypoint.sh", "fakecam.py", "hooks.py", "seed.py", "smtps.py", "media.py", "uploads.py", "s3bucket.py", "rustfs.sh", "vsftpd.conf", "sshd.conf", "smb.conf"]
  preview_tags       = [for key, value in { Project = "vivarium", ManagedBy = "opentofu" } : { key = key, value = value }]
}

data "archive_file" "preview" {
  for_each    = local.previews
  type        = "zip"
  output_path = "${path.module}/.build/${each.key}.zip"
  source {
    filename = "Dockerfile"
    content  = templatefile("${path.module}/motioneye/Dockerfile.tftpl", merge(each.value, { source = coalesce(each.value.source, each.value.repository), s3 = contains(try(each.value.services, []), "s3") }))
  }
  dynamic "source" {
    for_each = local.motioneye_files
    content {
      filename = "preview/${source.value}"
      content  = file("${path.module}/motioneye/${source.value}")
    }
  }
}

resource "aws_s3_object" "preview" {
  for_each = local.previews
  bucket   = aws_s3_bucket.artifacts.id
  key      = "previews/${each.key}/${data.archive_file.preview[each.key].output_sha256}.zip"
  source   = data.archive_file.preview[each.key].output_path
}

resource "aws_cloudwatch_log_group" "preview_build" {
  name              = "/vivarium/preview-build"
  retention_in_days = 30
}

resource "aws_iam_role" "preview_build" {
  name                 = "vivarium-preview-build"
  description          = "Builds the preview MicroVM images from their zips in S3."
  permissions_boundary = aws_iam_policy.workload_boundary.arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = ["sts:AssumeRole", "sts:TagSession"]
    }]
  })
}

resource "aws_iam_role_policy" "preview_build" {
  name = "preview-build"
  role = aws_iam_role.preview_build.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.artifacts.arn}/previews/*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.preview_build.arn}:*"
      },
    ]
  })
}

resource "awscc_lambda_microvm_image" "preview" {
  for_each           = local.previews
  name               = "vivarium-preview-${each.key}"
  description        = "${local.preview_labels[each.key]} with fake cameras"
  base_image_arn     = local.base_image_arn
  base_image_version = local.base_image_version
  build_role_arn     = aws_iam_role.preview_build.arn
  code_artifact = {
    uri = "s3://${aws_s3_object.preview[each.key].bucket}/${aws_s3_object.preview[each.key].key}"
  }
  cpu_configurations        = [{ architecture = "ARM_64" }]
  resources                 = [{ minimum_memory_in_mi_b = 1024 }]
  egress_network_connectors = ["${local.connector}:INTERNET_EGRESS"]
  # Cloud Control requires a value and ALL is the only one; it applies inside
  # the MicroVM, which has no execution role.
  additional_os_capabilities = ["ALL"]
  hooks = {
    port = 9000
    microvm_image_hooks = {
      ready                       = "ENABLED"
      ready_timeout_in_seconds    = 600
      validate                    = "ENABLED"
      validate_timeout_in_seconds = 300
    }
    microvm_hooks = {
      run       = "DISABLED"
      resume    = "DISABLED"
      suspend   = "DISABLED"
      terminate = "DISABLED"
    }
  }
  logging = {
    cloudwatch = {
      log_group = aws_cloudwatch_log_group.preview_build.name
    }
  }
  # Cloud Control requires the key and awscc drops an empty list.
  environment_variables = [{ key = "PREVIEW_COMMIT", value = each.value.commit }]
  tags                  = local.preview_tags

  depends_on = [aws_iam_role_policy.preview_build]

  lifecycle {
    precondition {
      condition     = each.value.repository == "motioneye-project/motioneye"
      error_message = "${each.key}: only motioneye-project/motioneye has an image template."
    }
    precondition {
      condition     = can(regex("^[0-9a-f]{40}$", each.value.commit))
      error_message = "${each.key}: commit must be a full SHA."
    }
    precondition {
      condition     = each.value.pull == null ? can(regex("^motioneye-([a-z0-9]+-)*[a-z0-9]*[a-z][a-z0-9]*$", each.key)) && length(each.key) <= 47 : each.key == "motioneye-${each.value.pull}"
      error_message = "${each.key}: the directory must be motioneye-<pull>, or without a pull request motioneye-<name> of at most 47 characters whose last part is not only digits."
    }
    precondition {
      condition     = each.value.source == null || can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", coalesce(each.value.source, "-")))
      error_message = "${each.key}: source must be an owner/name GitHub repository."
    }
    precondition {
      condition     = alltrue([for service in try(each.value.services, []) : contains(["s3"], service)])
      error_message = "${each.key}: services may only list \"s3\"."
    }
  }
}

data "archive_file" "preview_proxy" {
  type        = "zip"
  output_path = "${path.module}/.build/preview-proxy.zip"
  dynamic "source" {
    for_each = ["proxy-server.mjs", "index.mjs", "http.mjs", "session.mjs"]
    content {
      filename = source.value
      content  = file("${path.module}/preview-proxy/${source.value}")
    }
  }
}

resource "aws_s3_object" "preview_proxy" {
  bucket = aws_s3_bucket.artifacts.id
  key    = "${local.web_function_artifacts}/proxy-${data.archive_file.preview_proxy.output_sha256}.zip"
  source = data.archive_file.preview_proxy.output_path

  lifecycle {
    create_before_destroy = true
  }
}

# Lambda writes logs to the .local group first, then copies them to the other; it would create it with no retention.
resource "aws_cloudwatch_log_group" "preview_proxy" {
  for_each          = toset(["/vivarium/preview-proxy", "/vivarium/preview-proxy.local"])
  name              = each.value
  retention_in_days = 30
}

resource "aws_iam_role" "preview_proxy" {
  name                 = "vivarium-preview-proxy"
  description          = "Starts the preview MicroVMs and forwards to them."
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

resource "aws_iam_role_policy" "preview_proxy" {
  name = "preview-proxy"
  role = aws_iam_role.preview_proxy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(length(local.previews) > 0 ? [{
      Effect   = "Allow"
      Action   = ["lambda:RunMicrovm", "lambda:GetMicrovm", "lambda:CreateMicrovmAuthToken"]
      Resource = [for image in awscc_lambda_microvm_image.preview : image.image_arn]
      }] : [], [
      {
        Effect   = "Allow"
        Action   = "lambda:ListMicrovms"
        Resource = "*"
      },
      {
        # Lambda checks this against no resource.
        Effect   = "Allow"
        Action   = "lambda:PassNetworkConnector"
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [for group in aws_cloudwatch_log_group.preview_proxy : "${group.arn}:*"]
      },
    ])
  })
}

resource "aws_lambdaweb_function" "preview_proxy" {
  function_name = "vivarium-preview-proxy"
}

resource "aws_lambdaweb_function_revision" "preview_proxy" {
  function_name = aws_lambdaweb_function.preview_proxy.function_name
  description   = "Forwards each preview to its MicroVM."

  build_config {
    runtime_config {
      runtime = "nodejs24.x"
    }
    code_config {
      s3_object {
        bucket     = aws_s3_object.preview_proxy.bucket
        key        = aws_s3_object.preview_proxy.key
        version_id = aws_s3_object.preview_proxy.version_id
      }
    }
  }

  service_config {
    execution_role_arn = aws_iam_role.preview_proxy.arn
    timeout_seconds    = 60
    environment_variables = {
      AWS_LAMBDA_NODEJS_ENTRYPOINT = "proxy-server.mjs"
      INGRESS_CONNECTOR            = "${local.connector}:ALL_INGRESS"
      EGRESS_CONNECTOR             = aws_lambdacore_network_connector.preview.arn
      DOMAIN                       = local.preview_domain
      AUTH_URL                     = "https://${local.sign_in_host}"
      SESSION_KEY                  = random_password.preview_session.result
      ROUTES                       = jsonencode(jsondecode(file("${path.module}/motioneye/routes.json")))
      PREVIEWS = jsonencode({
        for name, preview in local.previews : name => {
          imageArn = awscc_lambda_microvm_image.preview[name].image_arn
          public   = preview.public
        }
      })
    }
    telemetry_config {
      logging_config {
        log_group = aws_cloudwatch_log_group.preview_proxy["/vivarium/preview-proxy"].name
      }
    }
  }

  depends_on = [aws_iam_role_policy.preview_proxy, aws_s3_bucket_policy.artifacts]

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lambdaweb_function_endpoint" "preview_proxy" {
  function_name        = aws_lambdaweb_function.preview_proxy.function_name
  endpoint_name        = "cloudfront"
  endpoint_type        = "HomeRegion"
  auth_type            = "IamAuth"
  auto_deployment_mode = "Disabled"

  revision_weight {
    revision_id = aws_lambdaweb_function_revision.preview_proxy.revision_id
    weight      = 100
  }
}

resource "aws_lambdaweb_resource_policy" "preview_proxy" {
  resource_arn = aws_lambdaweb_function.preview_proxy.arn
  policy       = local.cloudfront_invoke_policies.proxy
}

output "preview_links" {
  description = "Each preview's link, which signs the reviewer in with GitHub"
  value       = { for name in keys(local.previews) : name => "https://${local.sign_in_host}/${name}/" }
}
