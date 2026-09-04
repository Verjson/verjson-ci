terraform {
  required_version = "~> 1.16.0"
  required_providers {
    gitlab = {
      source  = "gitlabhq/gitlab"
      version = "~> 19.3"
    }
  }
}

provider "gitlab" {}

module "mirror" {
  source = "../.."

  namespace_id                 = 1
  mirror_deploy_key_public_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE2xwqRhoWmIpQ4fDo7X+YsFktRMfUtOYo4vC1qTCXW6 fixture"
}
