output "project_id" {
  value = gitlab_project.mirror.id
}

output "http_url_to_repo" {
  value = gitlab_project.mirror.http_url_to_repo
}
