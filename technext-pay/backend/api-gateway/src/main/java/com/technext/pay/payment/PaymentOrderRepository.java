package com.technext.pay.payment;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PaymentOrderRepository extends JpaRepository<PaymentOrder, UUID> {
    Optional<PaymentOrder> findByMerchant_IdAndIdempotencyKey(UUID merchantId, String key);
    Optional<PaymentOrder> findByIdAndMerchant_Id(UUID id, UUID merchantId);
    List<PaymentOrder> findTop100ByMerchant_IdOrderByCreatedAtDesc(UUID merchantId);
}
