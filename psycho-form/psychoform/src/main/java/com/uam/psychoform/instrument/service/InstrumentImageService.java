package com.uam.psychoform.instrument.service;

import com.uam.psychoform.instrument.model.EstadoVersionTest;
import com.uam.psychoform.instrument.model.ImagenItem;
import com.uam.psychoform.instrument.model.ImagenOpcion;
import com.uam.psychoform.instrument.model.Item;
import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.instrument.model.RecursoMultimedia;
import com.uam.psychoform.instrument.model.Subtest;
import com.uam.psychoform.instrument.model.TipoItem;
import com.uam.psychoform.instrument.model.TipoRecurso;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.EstadoGeneral;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import java.math.BigDecimal;
import com.uam.psychoform.storage.ObjectStorageService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.HexFormat;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class InstrumentImageService {
    private static final long MAX_IMAGE_BYTES = 25L * 1024L * 1024L;
    private static final int MAX_IDEMPOTENCY_KEY_LENGTH = 128;
    private static final Set<String> ALLOWED_MIME_TYPES = Set.of("image/png", "image/jpeg", "image/webp");

    private final EntityManager em;
    private final VersionTestRepository versions;
    private final UsuarioRepository users;
    private final CurrentActor currentActor;
    private final ObjectStorageService storage;
    private final Clock clock;

    public InstrumentImageService(EntityManager em, VersionTestRepository versions, UsuarioRepository users,
            CurrentActor currentActor, ObjectStorageService storage, Clock clock) {
        this.em = em;
        this.versions = versions;
        this.users = users;
        this.currentActor = currentActor;
        this.storage = storage;
        this.clock = clock;
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse uploadItemImage(long itemId, MultipartFile file, Integer order, String altText,
            String role) throws IOException {
        return uploadItemImage(itemId, file, order, altText, role, null);
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse uploadItemImage(long itemId, MultipartFile file, Integer order, String altText,
            String role, String idempotencyKey) throws IOException {
        String uploadKey = normalizeIdempotencyKey(idempotencyKey);
        byte[] bytes = validatedBytes(file);
        String hash = sha256(bytes);
        Item item = find(Item.class, itemId);
        requireDraft(item.getSubtest().getVersionTest().getId());
        RecursoMultimedia existing = findExistingIdempotentResource(uploadKey, hash);
        if (existing != null) {
            ImagenItem existingLink = findItemImageByItemAndResource(itemId, existing.getId());
            return response(existingLink.getId(), existing, existingLink.getNumeroOrden(),
                    existingLink.getTextoAlternativo(), existingLink.getRolImagen());
        }
        String key = storageKey("items", itemId, file.getOriginalFilename());
        storage.putObject(key, normalizedContentType(file), bytes);
        try {
            RecursoMultimedia resource = resource(file, bytes, hash, key, uploadKey);
            em.persist(resource);
            ImagenItem image = new ImagenItem();
            image.setItem(item);
            image.setRecurso(resource);
            image.setRolImagen(blank(role) ? "ENUNCIADO" : role);
            image.setNumeroOrden(order == null ? 1 : order);
            image.setTextoAlternativo(altText);
            em.persist(image);
            em.flush();
            return response(image.getId(), resource, image.getNumeroOrden(), image.getTextoAlternativo(),
                    image.getRolImagen());
        } catch (RuntimeException ex) {
            deleteBestEffort(key);
            throw duplicateOrderConflict(ex, "item", order == null ? 1 : order);
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public Item createItemWithImage(long subtestId, String code, TipoItem itemType, TipoRespuesta responseType,
            String prompt, String instruction, Integer order, BigDecimal baseScore, Integer timeLimitSeconds,
            Boolean required, Boolean confidential, MultipartFile file, Integer imageOrder, String altText,
            String role) throws IOException {
        Subtest subtest = find(Subtest.class, subtestId);
        requireDraft(subtest.getVersionTest().getId());

        Item item = new Item();
        item.setSubtest(subtest);
        item.setCodigoItem(code);
        item.setTipoItem(itemType);
        item.setTipoRespuesta(responseType);
        item.setEnunciado(prompt);
        item.setInstruccion(instruction);
        item.setNumeroOrden(order);
        item.setPuntajeBase(baseScore == null ? BigDecimal.ONE : baseScore);
        item.setTiempoLimiteSegundos(timeLimitSeconds);
        item.setEsObligatorio(!Boolean.FALSE.equals(required));
        item.setEsConfidencial(!Boolean.FALSE.equals(confidential));
        item.setEstado(EstadoGeneral.ACTIVO);
        em.persist(item);

        if (file != null && !file.isEmpty()) {
            uploadItemImage(item.getId(), file, imageOrder, altText, role);
        }

        return item;
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse uploadOptionImage(long optionId, MultipartFile file, Integer order, String altText)
            throws IOException {
        return uploadOptionImage(optionId, file, order, altText, null);
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse uploadOptionImage(long optionId, MultipartFile file, Integer order, String altText,
            String idempotencyKey) throws IOException {
        String uploadKey = normalizeIdempotencyKey(idempotencyKey);
        byte[] bytes = validatedBytes(file);
        String hash = sha256(bytes);
        OpcionItem option = find(OpcionItem.class, optionId);
        requireDraft(option.getItem().getSubtest().getVersionTest().getId());
        RecursoMultimedia existing = findExistingIdempotentResource(uploadKey, hash);
        if (existing != null) {
            ImagenOpcion existingLink = findOptionImageByOptionAndResource(optionId, existing.getId());
            return response(existingLink.getId(), existing, existingLink.getNumeroOrden(),
                    existingLink.getTextoAlternativo(), null);
        }
        String key = storageKey("options", optionId, file.getOriginalFilename());
        storage.putObject(key, normalizedContentType(file), bytes);
        try {
            RecursoMultimedia resource = resource(file, bytes, hash, key, uploadKey);
            em.persist(resource);
            ImagenOpcion image = new ImagenOpcion();
            image.setOpcion(option);
            image.setRecurso(resource);
            image.setNumeroOrden(order == null ? 1 : order);
            image.setTextoAlternativo(altText);
            em.persist(image);
            em.flush();
            return response(image.getId(), resource, image.getNumeroOrden(), image.getTextoAlternativo(), null);
        } catch (RuntimeException ex) {
            deleteBestEffort(key);
            throw duplicateOrderConflict(ex, "opcion", order == null ? 1 : order);
        }
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceItemImage(long itemId, long imageId, MultipartFile file, String altText,
            String role) throws IOException {
        return replaceItemImage(itemId, imageId, file, altText, role, null);
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceItemImage(long itemId, long imageId, MultipartFile file, String altText,
            String role, String idempotencyKey) throws IOException {
        ImagenItem image = find(ImagenItem.class, imageId);
        if (!image.getItem().getId().equals(itemId)) {
            throw new EntityNotFoundException("Imagen de item no encontrada: " + imageId);
        }
        requireDraft(image.getItem().getSubtest().getVersionTest().getId());
        return replaceItemImage(image, itemId, file, altText, role, normalizeIdempotencyKey(idempotencyKey));
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceItemImageByOrder(long itemId, int order, MultipartFile file, String altText,
            String role) throws IOException {
        return replaceItemImageByOrder(itemId, order, file, altText, role, null);
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceItemImageByOrder(long itemId, int order, MultipartFile file, String altText,
            String role, String idempotencyKey) throws IOException {
        Item item = find(Item.class, itemId);
        requireDraft(item.getSubtest().getVersionTest().getId());
        ImagenItem image = findItemImageByOrder(itemId, order);
        return replaceItemImage(image, itemId, file, altText, role, normalizeIdempotencyKey(idempotencyKey));
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceOptionImage(long optionId, long imageId, MultipartFile file, String altText)
            throws IOException {
        return replaceOptionImage(optionId, imageId, file, altText, null);
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceOptionImage(long optionId, long imageId, MultipartFile file, String altText,
            String idempotencyKey) throws IOException {
        ImagenOpcion image = find(ImagenOpcion.class, imageId);
        if (!image.getOpcion().getId().equals(optionId)) {
            throw new EntityNotFoundException("Imagen de opcion no encontrada: " + imageId);
        }
        requireDraft(image.getOpcion().getItem().getSubtest().getVersionTest().getId());
        return replaceOptionImage(image, optionId, file, altText, normalizeIdempotencyKey(idempotencyKey));
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceOptionImageByOrder(long optionId, int order, MultipartFile file, String altText)
            throws IOException {
        return replaceOptionImageByOrder(optionId, order, file, altText, null);
    }

    @Transactional
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceOptionImageByOrder(long optionId, int order, MultipartFile file, String altText,
            String idempotencyKey) throws IOException {
        OpcionItem option = find(OpcionItem.class, optionId);
        requireDraft(option.getItem().getSubtest().getVersionTest().getId());
        ImagenOpcion image = findOptionImageByOrder(optionId, order);
        return replaceOptionImage(image, optionId, file, altText, normalizeIdempotencyKey(idempotencyKey));
    }

    private ImageUploadResponse replaceItemImage(ImagenItem image, long itemId, MultipartFile file, String altText,
            String role, String uploadKey) throws IOException {
        byte[] bytes = validatedBytes(file);
        String hash = sha256(bytes);
        RecursoMultimedia existing = findExistingIdempotentResource(uploadKey, hash);
        if (existing != null) {
            if (image.getRecurso() != null && Objects.equals(image.getRecurso().getId(), existing.getId())) {
                return response(image.getId(), existing, image.getNumeroOrden(), image.getTextoAlternativo(),
                        image.getRolImagen());
            }
            throw new IllegalStateException("La Idempotency-Key ya fue utilizada en otra operacion");
        }
        String key = storageKey("items", itemId, file.getOriginalFilename());
        storage.putObject(key, normalizedContentType(file), bytes);
        RecursoMultimedia previousResource = image.getRecurso();
        String previousAltText = image.getTextoAlternativo();
        String previousRole = image.getRolImagen();
        try {
            RecursoMultimedia resource = resource(file, bytes, hash, key, uploadKey);
            em.persist(resource);
            image.setRecurso(resource);
            image.setTextoAlternativo(altText);
            image.setRolImagen(blank(role) ? previousRole : role);
            em.flush();
            deleteBestEffort(previousResource.getRutaAlmacenamiento());
            return response(image.getId(), resource, image.getNumeroOrden(), image.getTextoAlternativo(),
                    image.getRolImagen());
        } catch (RuntimeException ex) {
            image.setRecurso(previousResource);
            image.setTextoAlternativo(previousAltText);
            image.setRolImagen(previousRole);
            deleteBestEffort(key);
            throw ex;
        }
    }

    private ImageUploadResponse replaceOptionImage(ImagenOpcion image, long optionId, MultipartFile file,
            String altText, String uploadKey) throws IOException {
        byte[] bytes = validatedBytes(file);
        String hash = sha256(bytes);
        RecursoMultimedia existing = findExistingIdempotentResource(uploadKey, hash);
        if (existing != null) {
            if (image.getRecurso() != null && Objects.equals(image.getRecurso().getId(), existing.getId())) {
                return response(image.getId(), existing, image.getNumeroOrden(), image.getTextoAlternativo(), null);
            }
            throw new IllegalStateException("La Idempotency-Key ya fue utilizada en otra operacion");
        }
        String key = storageKey("options", optionId, file.getOriginalFilename());
        storage.putObject(key, normalizedContentType(file), bytes);
        RecursoMultimedia previousResource = image.getRecurso();
        String previousAltText = image.getTextoAlternativo();
        try {
            RecursoMultimedia resource = resource(file, bytes, hash, key, uploadKey);
            em.persist(resource);
            image.setRecurso(resource);
            image.setTextoAlternativo(altText);
            em.flush();
            deleteBestEffort(previousResource.getRutaAlmacenamiento());
            return response(image.getId(), resource, image.getNumeroOrden(), image.getTextoAlternativo(), null);
        } catch (RuntimeException ex) {
            image.setRecurso(previousResource);
            image.setTextoAlternativo(previousAltText);
            deleteBestEffort(key);
            throw ex;
        }
    }

    private byte[] validatedBytes(MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("El archivo de imagen esta vacio");
        }
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_MIME_TYPES.contains(contentType.toLowerCase())) {
            throw new IllegalArgumentException("Tipo de imagen no permitido: " + contentType);
        }
        if (file.getSize() > MAX_IMAGE_BYTES) {
            throw new IllegalArgumentException("La imagen excede 25MB");
        }
        return file.getBytes();
    }

    private String normalizedContentType(MultipartFile file) {
        return file.getContentType().toLowerCase();
    }

    private String normalizeIdempotencyKey(String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            return null;
        }
        String normalized = idempotencyKey.trim();
        if (normalized.length() > MAX_IDEMPOTENCY_KEY_LENGTH) {
            throw new IllegalArgumentException("Idempotency-Key excede " + MAX_IDEMPOTENCY_KEY_LENGTH + " caracteres");
        }
        return normalized;
    }

    private RecursoMultimedia findExistingIdempotentResource(String uploadKey, String hash) {
        if (uploadKey == null) {
            return null;
        }
        List<RecursoMultimedia> existing = em.createQuery(
                "SELECT r FROM RecursoMultimedia r WHERE r.claveSubida = :uploadKey",
                RecursoMultimedia.class)
                .setParameter("uploadKey", uploadKey)
                .setMaxResults(1)
                .getResultList();
        if (existing.isEmpty()) {
            return null;
        }
        RecursoMultimedia resource = existing.getFirst();
        if (!Objects.equals(resource.getHashIntegridad(), hash)) {
            throw new IllegalStateException("Ya existe un recurso con esta Idempotency-Key y un archivo distinto");
        }
        return resource;
    }

    private ImagenItem findItemImageByItemAndResource(long itemId, long resourceId) {
        List<ImagenItem> images = em.createQuery(
                "SELECT img FROM ImagenItem img WHERE img.item.id = :itemId AND img.recurso.id = :resourceId",
                ImagenItem.class)
                .setParameter("itemId", itemId)
                .setParameter("resourceId", resourceId)
                .setMaxResults(1)
                .getResultList();
        if (images.isEmpty()) {
            throw new IllegalStateException("La Idempotency-Key ya fue utilizada en otra operacion");
        }
        return images.getFirst();
    }

    private ImagenOpcion findOptionImageByOptionAndResource(long optionId, long resourceId) {
        List<ImagenOpcion> images = em.createQuery(
                "SELECT img FROM ImagenOpcion img WHERE img.opcion.id = :optionId AND img.recurso.id = :resourceId",
                ImagenOpcion.class)
                .setParameter("optionId", optionId)
                .setParameter("resourceId", resourceId)
                .setMaxResults(1)
                .getResultList();
        if (images.isEmpty()) {
            throw new IllegalStateException("La Idempotency-Key ya fue utilizada en otra operacion");
        }
        return images.getFirst();
    }

    private RecursoMultimedia resource(MultipartFile file, byte[] bytes, String hash, String key, String uploadKey) {
        RecursoMultimedia resource = new RecursoMultimedia();
        resource.setTipoRecurso(TipoRecurso.IMAGEN);
        resource.setNombreArchivo(originalFilename(file.getOriginalFilename()));
        resource.setRutaAlmacenamiento(key);
        resource.setTipoMime(normalizedContentType(file));
        resource.setTamanoBytes((long) bytes.length);
        resource.setHashIntegridad(hash);
        resource.setClaveSubida(uploadKey);
        resource.setEsConfidencial(true);
        resource.setRequiereAutorizacion(true);
        resource.setSubidoPor(currentUser());
        resource.setSubidoEn(LocalDateTime.now(clock));
        return resource;
    }

    private ImageUploadResponse response(Long imageLinkId, RecursoMultimedia resource, Integer order, String altText,
            String role) {
        return new ImageUploadResponse(imageLinkId, resource.getId(), resource.getRutaAlmacenamiento(),
                resource.getNombreArchivo(), resource.getTipoMime(), resource.getTamanoBytes(),
                resource.getHashIntegridad(), order, altText, role, resource.getClaveSubida());
    }

    private VersionTest requireDraft(long versionId) {
        VersionTest version = versions.findByIdForUpdate(versionId)
                .orElseThrow(() -> new EntityNotFoundException("Version no encontrada: " + versionId));
        if (version.getEstado() != EstadoVersionTest.BORRADOR) {
            throw new IllegalStateException("La version publicada o aprobada no se edita directamente");
        }
        return version;
    }

    private Usuario currentUser() {
        UUID id = currentActor.usuarioId();
        return users.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Usuario autenticado no encontrado: " + id));
    }

    private <T> T find(Class<T> type, Object id) {
        T value = em.find(type, id);
        if (value == null) {
            throw new EntityNotFoundException(type.getSimpleName() + " no encontrado: " + id);
        }
        return value;
    }

    private ImagenItem findItemImageByOrder(long itemId, int order) {
        List<ImagenItem> images = em.createQuery(
                "SELECT img FROM ImagenItem img WHERE img.item.id = :itemId AND img.numeroOrden = :order",
                ImagenItem.class)
                .setParameter("itemId", itemId)
                .setParameter("order", order)
                .setMaxResults(1)
                .getResultList();
        if (images.isEmpty()) {
            throw new EntityNotFoundException("Imagen de item no encontrada para item " + itemId + " y orden " + order);
        }
        return images.getFirst();
    }

    private ImagenOpcion findOptionImageByOrder(long optionId, int order) {
        List<ImagenOpcion> images = em.createQuery(
                "SELECT img FROM ImagenOpcion img WHERE img.opcion.id = :optionId AND img.numeroOrden = :order",
                ImagenOpcion.class)
                .setParameter("optionId", optionId)
                .setParameter("order", order)
                .setMaxResults(1)
                .getResultList();
        if (images.isEmpty()) {
            throw new EntityNotFoundException(
                    "Imagen de opcion no encontrada para opcion " + optionId + " y orden " + order);
        }
        return images.getFirst();
    }

    private RuntimeException duplicateOrderConflict(RuntimeException ex, String owner, int order) {
        if (isDuplicateImageOrder(ex)) {
            return new IllegalStateException("Ya existe una imagen para este " + owner + " en el orden " + order, ex);
        }
        return ex;
    }

    private boolean isDuplicateImageOrder(Throwable ex) {
        String message = rootMessage(ex).toLowerCase();
        return message.contains("duplicate") && message.contains("numero_orden")
                && (message.contains("imagen_item") || message.contains("imagen_opcion"));
    }

    private String rootMessage(Throwable ex) {
        Throwable cursor = ex;
        String message = "";
        while (cursor != null) {
            if (cursor.getMessage() != null) {
                message = cursor.getMessage();
            }
            cursor = cursor.getCause();
        }
        return message;
    }

    private String storageKey(String scope, long ownerId, String filename) {
        return "test-config/" + scope + "/" + ownerId + "/" + UUID.randomUUID() + "-" + sanitize(filename);
    }

    private String sanitize(String filename) {
        return originalFilename(filename).replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private String originalFilename(String filename) {
        if (blank(filename)) {
            return "image";
        }
        String normalized = filename.replace('\\', '/');
        int slash = normalized.lastIndexOf('/');
        return slash >= 0 ? normalized.substring(slash + 1) : normalized;
    }

    private String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 no disponible", ex);
        }
    }

    private void deleteBestEffort(String key) {
        try {
            storage.deleteObject(key);
        } catch (RuntimeException ignored) {
            // The database failure is the primary error; storage cleanup is best effort.
        }
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
