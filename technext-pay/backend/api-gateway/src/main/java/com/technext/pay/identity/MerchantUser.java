package com.technext.pay.identity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="merchant_users", uniqueConstraints=@UniqueConstraint(name="uq_merchant_user_email", columnNames={"email"}))
public class MerchantUser {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY, optional=false) @JoinColumn(name="merchant_id", nullable=false) private Merchant merchant;
    @Column(nullable=false, length=254) private String email;
    @Column(nullable=false, length=32) private String phone;
    @Column(name="password_hash", nullable=false, length=100) private String passwordHash;
    @Column(nullable=false, length=32) private String role;
    @Column(name="email_verified", nullable=false) private boolean emailVerified;
    @Column(name="phone_verified", nullable=false) private boolean phoneVerified;
    @Column(name="created_at", nullable=false) private Instant createdAt;
    protected MerchantUser() {}
    public MerchantUser(Merchant merchant,String email,String phone,String passwordHash){this.id=UUID.randomUUID();this.merchant=merchant;this.email=email;this.phone=phone;this.passwordHash=passwordHash;this.role="MERCHANT_OWNER";this.createdAt=Instant.now();}
    public UUID getId(){return id;} public Merchant getMerchant(){return merchant;} public String getEmail(){return email;} public String getPasswordHash(){return passwordHash;} public String getRole(){return role;}
}

