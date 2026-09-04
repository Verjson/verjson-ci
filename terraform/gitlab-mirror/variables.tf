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

variable "mirror_deploy_key_public_key" {
  description = "Public half of the dedicated SSH deploy key authorized to create protected mirror tags."
  type        = string
  validation {
    condition     = can(regex("^ssh-(ed25519|rsa) [A-Za-z0-9+/]+={0,3}( .*)?$", trimspace(var.mirror_deploy_key_public_key)))
    error_message = "mirror_deploy_key_public_key must be an OpenSSH Ed25519 or RSA public key."
  }
}

variable "mirror_deploy_key_title" {
  description = "Audit-visible title for the dedicated mirror deploy key."
  type        = string
  default     = "verjson-ci release mirror"
}
