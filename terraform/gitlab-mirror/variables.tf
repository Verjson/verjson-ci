variable "namespace_id" {
  description = "Numeric namespace ID that will own the mirror."
  type        = number
}

variable "project_name" {
  description = "Internal GitLab project name."
  type        = string
  default     = "verjson-ci"
}

variable "canonical_repository" {
  description = "Credential-free canonical repository URL recorded in project metadata."
  type        = string
  default     = "https://github.com/Verjson/verjson-ci"
  validation {
    condition     = !can(regex("://[^/]*@", var.canonical_repository))
    error_message = "canonical_repository must not contain credentials."
  }
}

variable "visibility_level" {
  description = "Visibility of the internal mirror project."
  type        = string
  default     = "private"
  validation {
    condition     = contains(["private", "internal", "public"], var.visibility_level)
    error_message = "visibility_level must be private, internal, or public."
  }
}

variable "shared_runners_enabled" {
  description = "Whether instance shared runners may run the mirrored component."
  type        = bool
  default     = false
}
