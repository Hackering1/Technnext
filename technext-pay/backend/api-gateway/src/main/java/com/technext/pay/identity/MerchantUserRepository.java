package com.technext.pay.identity;
import org.springframework.data.jpa.repository.JpaRepository; import java.util.*;
public interface MerchantUserRepository extends JpaRepository<MerchantUser,UUID> { Optional<MerchantUser> findFirstByEmailIgnoreCase(String email); boolean existsByEmailIgnoreCase(String email); }

