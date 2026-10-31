package com.technext.pay.identity;
import jakarta.persistence.LockModeType; import org.springframework.data.jpa.repository.*; import org.springframework.data.repository.query.Param; import java.util.*;
public interface MerchantRepository extends JpaRepository<Merchant,UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select m from Merchant m where m.id=:id") Optional<Merchant> findLockedById(@Param("id") UUID id);
}

