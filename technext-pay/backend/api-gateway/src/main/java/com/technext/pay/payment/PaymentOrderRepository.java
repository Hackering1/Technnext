package com.technext.pay.payment;
import org.springframework.data.jpa.repository.JpaRepository;import java.util.*;
public interface PaymentOrderRepository extends JpaRepository<PaymentOrder,UUID>{Optional<PaymentOrder> findByMerchantIdAndIdempotencyKey(UUID merchantId,String key);Optional<PaymentOrder> findByIdAndMerchantId(UUID id,UUID merchantId);List<PaymentOrder> findTop100ByMerchantIdOrderByCreatedAtDesc(UUID merchantId);}

