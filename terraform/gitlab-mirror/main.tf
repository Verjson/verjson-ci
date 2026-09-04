resource "gitlab_project" "mirror" {
  namespace_id                          = var.namespace_id
  name                                  = var.project_name
  description                           = "Internal mirror of ${var.canonical_repository}"
  visibility_level                      = var.visibility_level
  initialize_with_readme                = false
  shared_runners_enabled                = var.shared_runners_enabled
  only_allow_merge_if_pipeline_succeeds = true
}

resource "gitlab_deploy_key" "mirror" {
  project  = gitlab_project.mirror.id
  title    = var.mirror_deploy_key_title
  key      = trimspace(var.mirror_deploy_key_public_key)
  can_push = true
}

resource "gitlab_tag_protection" "release" {
  project             = gitlab_project.mirror.id
  tag                 = "*"
  create_access_level = "no one"

  allowed_to_create {
    deploy_key_id = gitlab_deploy_key.mirror.deploy_key_id
  }
}
