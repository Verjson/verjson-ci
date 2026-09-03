resource "gitlab_project" "mirror" {
  namespace_id             = var.namespace_id
  name                     = var.project_name
  description              = "Internal mirror of ${var.canonical_repository}"
  visibility_level         = var.visibility_level
  initialize_with_readme   = false
  shared_runners_enabled   = var.shared_runners_enabled
  only_allow_merge_if_pipeline_succeeds = true
}

resource "gitlab_project_protected_tag" "release" {
  project             = gitlab_project.mirror.id
  name                = "*"
  create_access_level = "maintainer"
}
