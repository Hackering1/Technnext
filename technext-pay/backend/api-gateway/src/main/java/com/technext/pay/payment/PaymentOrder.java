package com.technext.pay.payment;
import com.technext.pay.identity.Merchant; import jakarta.persistence.*; import java.time.Instant; import java.util.UUID;
@Entity @Table(name="platform_payment_orders",uniqueConstraints=@UniqueConstraint(name="uq_platform_orders_idempotency",columnNames={"merchant_id","idempotency_key"}))
public class PaymentOrder {
 @Id private UUID id; @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="merchant_id",nullable=false) private Merchant merchant;
 @Column(name="amount_minor",nullable=false) private long amountMinor; @Column(nullable=false,length=3) private String currency;
 @Column(nullable=false,length=300) private String description; @Enumerated(EnumType.STRING) @Column(nullable=false,length=24) private PaymentStatus status;
 @Column(name="idempotency_key",nullable=false,length=100) private String idempotencyKey; @Column(nullable=false,length=12) private String environment;
 @Column(name="created_at",nullable=false) private Instant createdAt; @Version private long version;
 protected PaymentOrder(){} public PaymentOrder(Merchant m,long amount,String currency,String description,String key){id=UUID.randomUUID();merchant=m;amountMinor=amount;this.currency=currency;this.description=description;idempotencyKey=key;environment="TEST";status=PaymentStatus.CREATED;createdAt=Instant.now();}
 public void transition(PaymentStatus next){status=PaymentStateMachine.transition(status,next);} public UUID getId(){return id;}public UUID getMerchantId(){return merchant.getId();}public long getAmountMinor(){return amountMinor;}public String getCurrency(){return currency;}public String getDescription(){return description;}public PaymentStatus getStatus(){return status;}public Instant getCreatedAt(){return createdAt;}public String getEnvironment(){return environment;}
}

