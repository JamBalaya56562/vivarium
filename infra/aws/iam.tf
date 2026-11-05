locals {
  subject_prefix = "repo:aletheia-works/vivarium"
  bootstrap = {
    account_id     = local.account_id
    subject_prefix = local.subject_prefix
    preview_domain = local.preview_domain
  }
}

resource "aws_iam_policy" "workload_boundary" {
  name        = "vivarium-workload-boundary"
  description = "The most any role this module creates may do."
  policy      = jsonencode(jsondecode(templatefile("${path.module}/bootstrap/workload-boundary.json.tftpl", local.bootstrap)))
}

resource "aws_iam_role" "tofu_plan" {
  name               = "github-actions-vivarium-tofu-plan"
  description        = "OpenTofu plan for infra/aws. Reads this module only."
  assume_role_policy = jsonencode(jsondecode(templatefile("${path.module}/bootstrap/trust-plan.json.tftpl", local.bootstrap)))
}

resource "aws_iam_role_policy" "tofu_plan_read" {
  name   = "tofu-read"
  role   = aws_iam_role.tofu_plan.name
  policy = jsonencode(jsondecode(templatefile("${path.module}/bootstrap/read-policy.json.tftpl", local.bootstrap)))
}

resource "aws_iam_role" "tofu_apply" {
  name               = "github-actions-vivarium-tofu-apply"
  description        = "OpenTofu apply for infra/aws from main."
  assume_role_policy = jsonencode(jsondecode(templatefile("${path.module}/bootstrap/trust-apply.json.tftpl", local.bootstrap)))
}

resource "aws_iam_role_policy" "tofu_apply_read" {
  name   = "tofu-read"
  role   = aws_iam_role.tofu_apply.name
  policy = jsonencode(jsondecode(templatefile("${path.module}/bootstrap/read-policy.json.tftpl", local.bootstrap)))
}

resource "aws_iam_role_policy" "tofu_apply" {
  name   = "tofu-apply"
  role   = aws_iam_role.tofu_apply.name
  policy = jsonencode(jsondecode(templatefile("${path.module}/bootstrap/apply-policy.json.tftpl", local.bootstrap)))
}

import {
  to = aws_iam_policy.workload_boundary
  id = "arn:aws:iam::${local.account_id}:policy/vivarium-workload-boundary"
}

import {
  to = aws_iam_role.tofu_plan
  id = "github-actions-vivarium-tofu-plan"
}

import {
  to = aws_iam_role_policy.tofu_plan_read
  id = "github-actions-vivarium-tofu-plan:tofu-read"
}

import {
  to = aws_iam_role.tofu_apply
  id = "github-actions-vivarium-tofu-apply"
}

import {
  to = aws_iam_role_policy.tofu_apply_read
  id = "github-actions-vivarium-tofu-apply:tofu-read"
}

import {
  to = aws_iam_role_policy.tofu_apply
  id = "github-actions-vivarium-tofu-apply:tofu-apply"
}
