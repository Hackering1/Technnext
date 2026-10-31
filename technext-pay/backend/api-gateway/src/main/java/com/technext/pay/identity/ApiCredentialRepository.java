package com.technext.pay.identity;
import org.springframework.data.jpa.repository.JpaRepository; import java.util.*;
public interface ApiCredentialRepository extends JpaRepository<ApiCredential,UUID> { Optional<ApiCredential> findBySecretHashAndRevokedAtIsNull(String hash); }

