import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DrawingUtils,
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import { BadgeCheck, Pencil, ScanFace, Search, Trash2, UsersRound } from "lucide-react";

import {
  createEmployee,
  deleteEmployee,
  enrollEmployeeFace,
  getEmployees,
  updateEmployee,
} from "../api/employee.api";
import { createLivenessSession } from "../api/recognition.api";

import {
  getApiErrorMessage,
} from "../api/error";

import {
  evaluateFaceCaptureQuality,
} from "../utils/faceQuality";

import type {
  Employee,
  EmployeeCreate,
  EmployeeUpdate,
} from "../types/employee";


/* ============================================================
   FORM TYPE
============================================================ */

interface EmployeeForm {
  employee_code: string;
  full_name: string;
  email: string;
  department: string;
  user_id: string;
}


/* ============================================================
   EMPTY FORM
============================================================ */

const emptyForm: EmployeeForm = {
  employee_code: "",
  full_name: "",
  email: "",
  department: "",
  user_id: "",
};

const FACE_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";


/* ============================================================
   PAGE
============================================================ */

export default function Employees() {
  const isAdmin = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}").role === "ADMIN";
    } catch {
      return false;
    }
  })();

  /* ----------------------------------------------------------
     Employees
  ---------------------------------------------------------- */

  const [
    employees,
    setEmployees,
  ] = useState<Employee[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    loadError,
    setLoadError,
  ] = useState("");

  const [
    search,
    setSearch,
  ] = useState("");


  /* ----------------------------------------------------------
     Modal
  ---------------------------------------------------------- */

  const [
    showModal,
    setShowModal,
  ] = useState(false);

  const [
    editingEmployee,
    setEditingEmployee,
  ] = useState<Employee | null>(null);

  const [
    form,
    setForm,
  ] = useState<EmployeeForm>({
    ...emptyForm,
  });

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    formError,
    setFormError,
  ] = useState("");


  /* ----------------------------------------------------------
     Delete
  ---------------------------------------------------------- */

  const [
    deletingId,
    setDeletingId,
  ] = useState<number | null>(null);

  const [
    deleteError,
    setDeleteError,
  ] = useState("");

  const [faceMessage, setFaceMessage] = useState("");
  const [faceError, setFaceError] = useState("");
  const [enrollingId, setEnrollingId] = useState<number | null>(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [capturedFrames, setCapturedFrames] = useState<File[]>([]);
  const [submittingEnrollment, setSubmittingEnrollment] = useState(false);
  const [enrollmentChallenge, setEnrollmentChallenge] = useState("WAITING");
  const [enrollmentChallengeIndex, setEnrollmentChallengeIndex] = useState(-1);
  const [enrollmentFeedback, setEnrollmentFeedback] = useState("Preparing face scan...");
  const [livenessComplete, setLivenessComplete] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const livenessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const livenessSocketRef = useRef<WebSocket | null>(null);
  const livenessTimerRef = useRef<number | null>(null);
  const meshAnimationRef = useRef<number | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const autoScanTimerRef = useRef<number | null>(null);
  const captureInFlightRef = useRef(false);
  const capturedFramesRef = useRef<File[]>([]);
  const submittingEnrollmentRef = useRef(false);
  const livenessCompleteRef = useRef(false);


  /* ==========================================================
     LOAD EMPLOYEES
  ========================================================== */

  async function loadEmployees() {

    try {

      setLoading(true);
      setLoadError("");

      const data =
        await getEmployees();

      setEmployees(data);

    } catch (error) {

      console.error(
        "Failed to load employees:",
        error
      );

      setLoadError(
        getApiErrorMessage(error)
      );

    } finally {

      setLoading(false);

    }
  }


  useEffect(() => {
    loadEmployees();
  }, []);


  /* ==========================================================
     FILTER
  ========================================================== */

  const filteredEmployees =
    useMemo(() => {

      const keyword =
        search
          .trim()
          .toLowerCase();

      if (!keyword) {
        return employees;
      }

      return employees.filter(
        (employee) => {

          return [
            employee.employee_code,
            employee.full_name,
            employee.email,
            employee.department || "",
            String(employee.user_id),
          ]
            .join(" ")
            .toLowerCase()
            .includes(keyword);

        }
      );

    }, [employees, search]);


  /* ==========================================================
     CREATE MODAL
  ========================================================== */

  function openCreateModal() {

    setEditingEmployee(null);

    setForm({
      ...emptyForm,
    });

    setFormError("");
    setShowModal(true);
  }


  /* ==========================================================
     EDIT MODAL
  ========================================================== */

  function openEditModal(
    employee: Employee
  ) {

    setEditingEmployee(employee);

    setForm({
      employee_code:
        employee.employee_code,

      full_name:
        employee.full_name,

      email:
        employee.email,

      department:
        employee.department || "",

      user_id:
        String(employee.user_id),
    });

    setFormError("");
    setShowModal(true);
  }


  /* ==========================================================
     CLOSE MODAL
  ========================================================== */

  function closeModal() {

    if (saving) {
      return;
    }

    setShowModal(false);

    setEditingEmployee(null);

    setForm({
      ...emptyForm,
    });

    setFormError("");
  }


  /* ==========================================================
     CHANGE FORM
  ========================================================== */

  function handleChange(
    field: keyof EmployeeForm,
    value: string
  ) {

    setForm((current) => ({
      ...current,
      [field]: value,
    }));

    setFormError("");
  }


  /* ==========================================================
     SUBMIT
  ========================================================== */

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {

    event.preventDefault();

    setFormError("");


    /* --------------------------------------------------------
       Required fields
    -------------------------------------------------------- */

    if (
      !form.employee_code.trim() ||
      !form.full_name.trim() ||
      !form.email.trim()
    ) {

      setFormError(
        "Please fill in all required fields."
      );

      return;
    }


    /* --------------------------------------------------------
       User ID - CREATE ONLY
    -------------------------------------------------------- */

    let userId: number | undefined;

    if (!editingEmployee) {

      if (!form.user_id.trim()) {

        setFormError(
          "User ID is required."
        );

        return;
      }

      userId =
        Number(form.user_id);

      if (
        !Number.isInteger(userId) ||
        userId <= 0
      ) {

        setFormError(
          "User ID must be a valid number."
        );

        return;
      }
    }


    /* --------------------------------------------------------
       API
    -------------------------------------------------------- */

    try {

      setSaving(true);

      setFormError("");


      /* ======================================================
         UPDATE
      ====================================================== */

      if (editingEmployee) {

        const data: EmployeeUpdate = {

          employee_code:
            form.employee_code.trim(),

          full_name:
            form.full_name.trim(),

          email:
            form.email.trim(),

          department:
            form.department.trim()
              ? form.department.trim()
              : null,
        };


        const updated =
          await updateEmployee(
            editingEmployee.id,
            data
          );


        setEmployees(
          (current) =>
            current.map(
              (employee) =>
                employee.id ===
                editingEmployee.id
                  ? updated
                  : employee
            )
        );

      }


      /* ======================================================
         CREATE
      ====================================================== */

      else {

        const data: EmployeeCreate = {

          employee_code:
            form.employee_code.trim(),

          full_name:
            form.full_name.trim(),

          email:
            form.email.trim(),

          department:
            form.department.trim()
              ? form.department.trim()
              : null,

          user_id: userId!,
        };


        const created =
          await createEmployee(
            data
          );


        setEmployees(
          (current) => [
            ...current,
            created,
          ]
        );

        closeModal();
        startFaceEnrollment(created.id);
        return;
      }


      closeModal();

    } catch (error) {

      console.error(
        "Failed to save employee:",
        error
      );

      setFormError(
        getApiErrorMessage(error)
      );

    } finally {

      setSaving(false);

    }
  }


  /* ==========================================================
     DELETE
  ========================================================== */

  async function handleDelete(
    employee: Employee
  ) {

    const confirmed =
      window.confirm(
        `Are you sure you want to delete ${employee.full_name}?`
      );

    if (!confirmed) {
      return;
    }


    try {

      setDeletingId(
        employee.id
      );

      setDeleteError("");


      await deleteEmployee(
        employee.id
      );


      setEmployees(
        (current) =>
          current.filter(
            (item) =>
              item.id !==
              employee.id
          )
      );

    } catch (error) {

      console.error(
        "Failed to delete employee:",
        error
      );

      setDeleteError(
        getApiErrorMessage(error)
      );

    } finally {

      setDeletingId(null);

    }
  }

  function stopCameraStream() {
    if (autoScanTimerRef.current !== null) {
      window.clearInterval(autoScanTimerRef.current);
      autoScanTimerRef.current = null;
    }

    if (livenessTimerRef.current !== null) {
      window.clearInterval(livenessTimerRef.current);
      livenessTimerRef.current = null;
    }

    livenessSocketRef.current?.close();
    livenessSocketRef.current = null;

    if (meshAnimationRef.current !== null) {
      window.cancelAnimationFrame(meshAnimationRef.current);
      meshAnimationRef.current = null;
    }
    faceLandmarkerRef.current?.close();
    faceLandmarkerRef.current = null;

    const stream = cameraStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }

    const video = cameraVideoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }

  async function startEnrollmentMesh() {
    const video = cameraVideoRef.current;
    const canvas = document.getElementById("enrollment-mesh-canvas") as HTMLCanvasElement | null;
    if (!video || !canvas) return;

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
    );
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_MODEL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
    });
    faceLandmarkerRef.current = landmarker;
    const context = canvas.getContext("2d");
    if (!context) return;
    const drawingUtils = new DrawingUtils(context);

    const drawMesh = () => {
      if (!faceLandmarkerRef.current || video.videoWidth === 0 || video.videoHeight === 0) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.clearRect(0, 0, canvas.width, canvas.height);
      const result = landmarker.detectForVideo(video, performance.now());
      for (const landmarks of result.faceLandmarks) {
        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
          color: "rgba(45, 212, 191, 0.72)",
          lineWidth: 1,
        });
        drawingUtils.drawLandmarks(landmarks, {
          color: "rgba(255, 255, 255, 0.9)",
          radius: 1,
        });
      }
      meshAnimationRef.current = window.requestAnimationFrame(drawMesh);
    };

    drawMesh();
  }

  async function startEnrollmentLiveness() {
    try {
      const session = await createLivenessSession();
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const token = localStorage.getItem("access_token");
      const socket = new WebSocket(
        `${protocol}//${window.location.host}/api/attendance/liveness/${session.session_id}?access_token=${encodeURIComponent(token || "")}`
      );
      socket.binaryType = "arraybuffer";
      livenessSocketRef.current = socket;

      socket.onopen = () => {
        setEnrollmentFeedback("Keep your face inside the frame...");
        livenessTimerRef.current = window.setInterval(() => {
          const video = cameraVideoRef.current;
          const canvas = livenessCanvasRef.current;
          if (!video || !canvas || socket.readyState !== WebSocket.OPEN || video.videoWidth === 0) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext("2d");
          if (!context) return;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (blob && socket.readyState === WebSocket.OPEN) socket.send(blob);
          }, "image/jpeg", 0.75);
        }, 1000 / 12);
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as {
          challenge?: string;
          challenge_index?: number;
          feedback?: string;
          error?: string;
        };
        if (message.error) {
          setCameraError(message.error);
          return;
        }
        setEnrollmentChallenge(message.challenge || "WAITING");
        setEnrollmentChallengeIndex(message.challenge_index ?? -1);
        setEnrollmentFeedback(message.feedback || "Follow the instruction on screen...");
        if (message.challenge === "COMPLETE") {
          livenessCompleteRef.current = true;
          setLivenessComplete(true);
          setEnrollmentFeedback("Liveness verified. Hold still while we scan 3 samples...");
          if (livenessTimerRef.current !== null) {
            window.clearInterval(livenessTimerRef.current);
            livenessTimerRef.current = null;
          }
          socket.close();
        }
      };
      socket.onerror = () => setCameraError("Unable to connect to liveness verification.");
    } catch (error) {
      setCameraError(getApiErrorMessage(error, "Unable to start liveness verification."));
    }
  }

  async function openCameraForEnrollment() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported by this browser.");
      return;
    }

    try {
      setCameraError("");
      setCameraLoading(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      cameraStreamRef.current = stream;
      const video = cameraVideoRef.current;
      if (!video) {
        throw new Error("Camera preview is unavailable.");
      }

      video.srcObject = stream;
      await video.play();
      void startEnrollmentMesh().catch(() => setCameraError("Unable to load face mesh."));
      void startEnrollmentLiveness();
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Camera permission was denied. Please allow camera access and try again."
          : getApiErrorMessage(error, "Unable to open the camera.");
      setCameraError(message);
    } finally {
      setCameraLoading(false);
    }
  }

  useEffect(() => {
    if (!showCameraModal) {
      stopCameraStream();
      return;
    }

    void openCameraForEnrollment();
    autoScanTimerRef.current = window.setInterval(() => {
      if (livenessCompleteRef.current && capturedFramesRef.current.length < 3 && !submittingEnrollmentRef.current) {
        void handleCaptureFrame();
      }
    }, 1400);

    return () => {
      stopCameraStream();
    };
  }, [showCameraModal]);

  useEffect(() => {
    if (capturedFrames.length >= 3 && !submittingEnrollment) {
      void submitCapturedFrames();
    }
  }, [capturedFrames.length, submittingEnrollment]);

  function closeCameraModal() {
    setShowCameraModal(false);
    capturedFramesRef.current = [];
    livenessCompleteRef.current = false;
    setCapturedFrames([]);
    setLivenessComplete(false);
    setEnrollmentChallenge("WAITING");
    setEnrollmentChallengeIndex(-1);
    setEnrollmentFeedback("Preparing face scan...");
    setCameraError("");
    setCameraLoading(false);
    setEnrollingId(null);
    stopCameraStream();
  }

  async function handleCaptureFrame() {
    if (captureInFlightRef.current || capturedFramesRef.current.length >= 3) {
      return;
    }

    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;

    if (!video || !canvas) {
      setCameraError("The camera is not ready yet. Please try again.");
      return;
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError("The camera is still starting. Please wait a moment.");
      return;
    }

    try {
      captureInFlightRef.current = true;
      const width = video.videoWidth;
      const height = video.videoHeight;
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas is not available.");
      }

      context.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (nextBlob) => {
            if (nextBlob) {
              resolve(nextBlob);
              return;
            }
            reject(new Error("Unable to encode the camera image."));
          },
          "image/jpeg",
          0.9
        );
      });

      const imageBitmap = await createImageBitmap(blob);
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = imageBitmap.width;
      tempCanvas.height = imageBitmap.height;
      const tempContext = tempCanvas.getContext("2d");
      if (!tempContext) {
        throw new Error("Image processing is not available.");
      }
      tempContext.drawImage(imageBitmap, 0, 0);
      const imageData = tempContext.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const quality = evaluateFaceCaptureQuality(imageData);

      if (!quality.valid) {
        setCameraError(quality.message);
        return;
      }

      const file = new File([blob], `employee-${Date.now()}.jpg`, { type: "image/jpeg" });
      setCapturedFrames((current) => {
        const nextFrames = [...current, file];
        capturedFramesRef.current = nextFrames;
        return nextFrames;
      });
      setCameraError("");
    } catch (error) {
      setCameraError(getApiErrorMessage(error, "Unable to capture the face frame."));
    } finally {
      captureInFlightRef.current = false;
    }
  }

  async function submitCapturedFrames() {
    if (enrollingId === null || capturedFrames.length === 0) {
      return;
    }

    try {
      submittingEnrollmentRef.current = true;
      setSubmittingEnrollment(true);
      setFaceError("");
      const result = await enrollEmployeeFace(enrollingId, capturedFrames);
      setFaceMessage(`${result.embeddings_saved} face embeddings saved. This employee can now use AI check-in.`);
      setEmployees((current) => current.map((employee) => employee.id === enrollingId ? { ...employee, face_enrolled: true } : employee));
      closeCameraModal();
    } catch (error) {
      setFaceError(getApiErrorMessage(error));
      closeCameraModal();
    } finally {
      submittingEnrollmentRef.current = false;
      setSubmittingEnrollment(false);
    }
  }

  function startFaceEnrollment(employeeId: number) {
    setFaceError("");
    setFaceMessage("");
    setEnrollingId(employeeId);
    setCapturedFrames([]);
    setShowCameraModal(true);
  }

  /* ==========================================================
     RENDER
  ========================================================== */

  return (
    <div className="mx-auto w-full max-w-[1600px]">

      {/* ======================================================
          HEADER
      ====================================================== */}

      <header
        className="
          mb-7
          flex flex-col
          gap-4
          sm:flex-row
          sm:items-center
          sm:justify-between
        "
      >

        <div>

          <div
            className="
              mb-1
              text-[11px]
              font-bold
              uppercase
              tracking-[0.12em]
              text-blue-600
            "
          >
            Management
          </div>

          <h1
            className="
              text-2xl
              font-extrabold
              tracking-tight
              text-slate-900
              sm:text-3xl
            "
          >
            Employees
          </h1>

          <p
            className="
              mt-1.5
              text-sm
              text-slate-500
            "
          >
            Manage employee information
            and account assignments
          </p>

        </div>


        {isAdmin && <button
          type="button"
          onClick={openCreateModal}
          disabled={loading}
          className="
            inline-flex
            items-center
            justify-center
            rounded-xl
            bg-blue-600
            px-5 py-3
            text-sm font-bold
            text-white
            shadow-sm
            transition

            hover:bg-blue-700
            hover:shadow-md

            focus:outline-none
            focus:ring-2
            focus:ring-blue-200

            disabled:cursor-not-allowed
            disabled:opacity-50
          "
        >
          <span className="mr-2 text-lg">
            +
          </span>

          Add Employee
        </button>}

      </header>

      {showCameraModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-600">Face enrollment</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">Capture live face sample</h2>
              </div>

              <button
                type="button"
                onClick={closeCameraModal}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              <video
                ref={cameraVideoRef}
                autoPlay
                muted
                playsInline
                className="h-[420px] w-full object-cover"
              />
              <canvas
                id="enrollment-mesh-canvas"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4">
                <span className="rounded-full bg-slate-950/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur">
                  {enrollmentFeedback}
                </span>
              </div>
              <canvas ref={cameraCanvasRef} className="hidden" />
              <canvas ref={livenessCanvasRef} className="hidden" />
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-500">
                {livenessComplete
                  ? `${capturedFrames.length}/3 clean frame(s) scanned`
                  : "Complete the liveness checks before sample scanning"}
              </div>

              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide">
                {([
                  ["BLINK", "Chớp mắt", 0],
                  ["OPEN_MOUTH", "Mở miệng", 1],
                  ["BLINK_TWICE", "Chớp mắt 2 lần", 2],
                ] as const).map(([key, label, index]) => (
                  <span
                    key={key}
                    className={`rounded-full px-2.5 py-1 ${
                      enrollmentChallenge === key
                        ? "bg-amber-100 text-amber-700"
                        : enrollmentChallenge === "COMPLETE" || enrollmentChallengeIndex > index
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <p className="mt-3 text-center text-sm font-semibold text-emerald-600">
              {submittingEnrollment ? "Saving enrollment..." : livenessComplete ? "Scanning automatically..." : "Mesh tracking active"}
            </p>

            {(cameraError || faceError) && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {cameraError || faceError}
              </div>
            )}
          </div>
        </div>
      )}

      {(faceMessage || faceError) && (
        <div
          className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
            faceError
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {faceError || faceMessage}
        </div>
      )}


      {/* ======================================================
          DELETE ERROR
      ====================================================== */}

      {deleteError && (

        <div
          className="
            mb-5
            flex items-center
            gap-3
            rounded-xl
            border border-red-200
            bg-red-50
            px-4 py-3
            text-sm
            text-red-700
          "
        >

          <span
            className="
              flex h-7 w-7
              shrink-0
              items-center justify-center
              rounded-full
              bg-red-100
              font-bold
            "
          >
            !
          </span>

          <span className="flex-1">
            {deleteError}
          </span>

          <button
            type="button"
            onClick={() =>
              setDeleteError("")
            }
            className="
              rounded-lg
              px-2 py-1
              text-red-400
              hover:bg-red-100
              hover:text-red-700
            "
          >
            ×
          </button>

        </div>

      )}


      {/* ======================================================
          EMPLOYEE CARD
      ====================================================== */}

      <section
        className="
          overflow-hidden
          rounded-2xl
          border border-slate-200
          bg-white
          shadow-sm
        "
      >

        {/* ====================================================
            TOOLBAR
        ==================================================== */}

        <div
          className="
            flex flex-col
            gap-4
            border-b border-slate-100
            p-5
            sm:flex-row
            sm:items-center
            sm:justify-between
            sm:p-6
          "
        >

          {/* Search */}

          <div
            className="
              relative
              w-full
              sm:max-w-xl
            "
          >

            <span
              className="
                pointer-events-none
                absolute
                left-4
                top-1/2
                -translate-y-1/2
                text-base
                text-slate-400
              "
            >
              <Search size={17} strokeWidth={2} />
            </span>

            <input
              type="text"
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              disabled={loading}
              placeholder="Search by employee code, name, email or department..."
              className="
                w-full
                rounded-xl
                border border-slate-200
                bg-slate-50
                py-3
                pl-11
                pr-4
                text-sm
                text-slate-800
                outline-none
                transition

                placeholder:text-slate-400

                focus:border-blue-400
                focus:bg-white
                focus:ring-4
                focus:ring-blue-50

                disabled:cursor-not-allowed
                disabled:opacity-60
              "
            />

          </div>


          {/* Count */}

          <div
            className="
              shrink-0
              text-sm
              font-semibold
              text-slate-400
            "
          >
            <span className="text-slate-700">
              {filteredEmployees.length}
            </span>{" "}
            {filteredEmployees.length === 1
              ? "employee"
              : "employees"}
          </div>

        </div>


        {/* ====================================================
            LOADING
        ==================================================== */}

        {loading && (

          <div
            className="
              flex
              min-h-[320px]
              flex-col
              items-center
              justify-center
              gap-4
            "
          >

            <div
              className="
                h-10 w-10
                animate-spin
                rounded-full
                border-4
                border-slate-200
                border-t-blue-600
              "
            />

            <p
              className="
                text-sm
                font-medium
                text-slate-500
              "
            >
              Loading employees...
            </p>

          </div>

        )}


        {/* ====================================================
            ERROR
        ==================================================== */}

        {!loading && loadError && (

          <div
            className="
              flex
              min-h-[320px]
              flex-col
              items-center
              justify-center
              px-6
              text-center
            "
          >

            <div
              className="
                mb-4
                flex h-12 w-12
                items-center justify-center
                rounded-full
                bg-red-50
                text-lg font-bold
                text-red-600
              "
            >
              !
            </div>

            <h3
              className="
                text-base
                font-bold
                text-slate-800
              "
            >
              Unable to load employees
            </h3>

            <p
              className="
                mt-2
                max-w-md
                text-sm
                leading-6
                text-slate-500
              "
            >
              {loadError}
            </p>

            <button
              type="button"
              onClick={loadEmployees}
              className="
                mt-5
                rounded-xl
                bg-blue-600
                px-5 py-2.5
                text-sm font-bold
                text-white
                transition
                hover:bg-blue-700
                focus:outline-none
                focus:ring-4
                focus:ring-blue-100
              "
            >
              Try Again
            </button>

          </div>

        )}


        {/* ====================================================
            EMPTY
        ==================================================== */}

        {!loading &&
          !loadError &&
          filteredEmployees.length === 0 && (

            <div
              className="
                flex
                min-h-[320px]
                flex-col
                items-center
                justify-center
                px-6
                text-center
              "
            >

              <div
                className="
                  mb-4
                  flex h-16 w-16
                  items-center justify-center
                  rounded-2xl
                  bg-slate-100
                  text-2xl
                "
              >
                <UsersRound size={28} strokeWidth={1.8} />
              </div>

              <h3
                className="
                  text-base
                  font-bold
                  text-slate-800
                "
              >
                {search
                  ? "No employees found"
                  : "No employees yet"}
              </h3>

              <p
                className="
                  mt-2
                  max-w-sm
                  text-sm
                  leading-6
                  text-slate-500
                "
              >
                {search
                  ? "Try changing your search keyword."
                  : "Start by creating your first employee."}
              </p>

              {!search && isAdmin && (

                <button
                  type="button"
                  onClick={
                    openCreateModal
                  }
                  className="
                    mt-5
                    rounded-xl
                    bg-blue-600
                    px-5 py-2.5
                    text-sm font-bold
                    text-white
                    transition
                    hover:bg-blue-700
                  "
                >
                  + Add Employee
                </button>

              )}

            </div>

          )}


        {/* ====================================================
            TABLE
        ==================================================== */}

        {!loading &&
          !loadError &&
          filteredEmployees.length > 0 && (

            <div
              className="
                overflow-x-auto
              "
            >

              <table
                className="
                  min-w-[900px]
                  w-full
                  border-collapse
                "
              >

                <thead>

                  <tr
                    className="
                      border-b border-slate-100
                      bg-slate-50/70
                    "
                  >

                    <th
                      className="
                        px-5 py-4
                        text-left
                        text-[11px]
                        font-bold
                        uppercase
                        tracking-wider
                        text-slate-400
                      "
                    >
                      Employee
                    </th>

                    <th
                      className="
                        px-5 py-4
                        text-left
                        text-[11px]
                        font-bold
                        uppercase
                        tracking-wider
                        text-slate-400
                      "
                    >
                      Name
                    </th>

                    <th
                      className="
                        px-5 py-4
                        text-left
                        text-[11px]
                        font-bold
                        uppercase
                        tracking-wider
                        text-slate-400
                      "
                    >
                      Email
                    </th>

                    <th
                      className="
                        px-5 py-4
                        text-left
                        text-[11px]
                        font-bold
                        uppercase
                        tracking-wider
                        text-slate-400
                      "
                    >
                      Department
                    </th>

                    <th
                      className="
                        px-5 py-4
                        text-left
                        text-[11px]
                        font-bold
                        uppercase
                        tracking-wider
                        text-slate-400
                      "
                    >
                      User ID
                    </th>

                    <th
                      className="
                        px-5 py-4
                        text-right
                        text-[11px]
                        font-bold
                        uppercase
                        tracking-wider
                        text-slate-400
                      "
                    >
                      Actions
                    </th>

                  </tr>

                </thead>


                <tbody
                  className="
                    divide-y divide-slate-100
                  "
                >

                  {filteredEmployees.map(
                    (employee) => (

                      <tr
                        key={employee.id}
                        className="
                          transition
                          hover:bg-slate-50/70
                        "
                      >

                        {/* Employee Code */}

                        <td
                          className="
                            px-5 py-4
                          "
                        >

                          <span
                            className="
                              rounded-lg
                              bg-blue-50
                              px-2.5 py-1.5
                              text-xs
                              font-bold
                              text-blue-600
                            "
                          >
                            {employee.employee_code}
                          </span>

                        </td>


                        {/* Name */}

                        <td
                          className="
                            px-5 py-4
                          "
                        >

                          <div
                            className="
                              flex
                              items-center
                              gap-3
                            "
                          >

                            <div
                              className="
                                flex h-9 w-9
                                shrink-0
                                items-center
                                justify-center
                                rounded-full
                                bg-slate-100
                                text-xs font-bold
                                text-slate-600
                              "
                            >
                              {getInitials(
                                employee.full_name
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate whitespace-nowrap text-sm font-bold text-slate-800">
                                  {employee.full_name}
                                </span>
                                {employee.face_enrolled && (
                                  <span title="Face capture verified">
                                    <BadgeCheck
                                      size={17}
                                      strokeWidth={2.5}
                                      className="shrink-0 text-emerald-600"
                                      aria-label="Face capture verified"
                                    />
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                                {employee.face_enrolled ? "Face verified" : "Face not captured"}
                              </p>
                            </div>

                          </div>

                        </td>


                        {/* Email */}

                        <td
                          className="
                            px-5 py-4
                          "
                        >

                          <span
                            className="
                              text-sm
                              text-slate-500
                            "
                          >
                            {employee.email}
                          </span>

                        </td>


                        {/* Department */}

                        <td
                          className="
                            px-5 py-4
                          "
                        >

                          {employee.department ? (

                            <span
                              className="
                                inline-flex
                                rounded-lg
                                bg-slate-100
                                px-2.5 py-1.5
                                text-xs
                                font-semibold
                                text-slate-600
                              "
                            >
                              {employee.department}
                            </span>

                          ) : (

                            <span
                              className="
                                text-sm
                                text-slate-300
                              "
                            >
                              —
                            </span>

                          )}

                        </td>


                        {/* User ID */}

                        <td
                          className="
                            px-5 py-4
                          "
                        >

                          <span
                            className="
                              text-sm
                              font-semibold
                              text-slate-500
                            "
                          >
                            #{employee.user_id}
                          </span>

                        </td>


                        {/* Actions */}

                        <td
                          className="
                            px-5 py-4
                          "
                        >

                          {isAdmin && <div
                            className="
                              flex
                              justify-end
                              gap-2
                            "
                          >

                            {/* Face enrollment */}

                            <button
                              type="button"
                              title={employee.face_enrolled ? "Recapture face" : "Capture face"}
                              onClick={() => startFaceEnrollment(employee.id)}
                              disabled={enrollingId !== null || saving}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-500 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {enrollingId === employee.id ? "..." : employee.face_enrolled ? <BadgeCheck size={17} strokeWidth={2.5} /> : <ScanFace size={17} strokeWidth={2} />}
                            </button>

                            {/* Edit */}

                            <button
                              type="button"
                              title="Edit employee"
                              onClick={() =>
                                openEditModal(
                                  employee
                                )
                              }
                              disabled={
                                deletingId !== null ||
                                saving
                              }
                              className="
                                flex h-9 w-9
                                items-center
                                justify-center
                                rounded-lg
                                border border-slate-200
                                bg-white
                                text-sm
                                text-slate-500
                                transition

                                hover:border-blue-200
                                hover:bg-blue-50
                                hover:text-blue-600

                                disabled:cursor-not-allowed
                                disabled:opacity-40
                              "
                            >
                              <Pencil size={16} strokeWidth={2} />
                            </button>


                            {/* Delete */}

                            <button
                              type="button"
                              title="Delete employee"
                              onClick={() =>
                                handleDelete(
                                  employee
                                )
                              }
                              disabled={
                                deletingId ===
                                  employee.id ||
                                saving
                              }
                              className="
                                flex h-9 w-9
                                items-center
                                justify-center
                                rounded-lg
                                border border-slate-200
                                bg-white
                                text-sm
                                text-slate-400
                                transition

                                hover:border-red-200
                                hover:bg-red-50
                                hover:text-red-600

                                disabled:cursor-not-allowed
                                disabled:opacity-40
                              "
                            >
                              {deletingId ===
                              employee.id
                                ? (
                                  <span
                                    className="
                                      h-4 w-4
                                      animate-spin
                                      rounded-full
                                      border-2
                                      border-slate-200
                                      border-t-red-500
                                    "
                                  />
                                )
                                : <Trash2 size={16} strokeWidth={2} />}
                            </button>

                          </div>}

                        </td>

                      </tr>

                    )
                  )}

                </tbody>

              </table>

            </div>

          )}

      </section>


      {/* ======================================================
          MODAL
      ====================================================== */}

      {showModal && (

        <div
          className="
            fixed inset-0 z-[100]
            flex items-center
            justify-center
            bg-slate-900/50
            p-4
            backdrop-blur-sm
          "
          onMouseDown={(event) => {

            if (
              event.target ===
              event.currentTarget
            ) {
              closeModal();
            }

          }}
        >

          <div
            className="
              w-full
              max-w-lg
              overflow-hidden
              rounded-2xl
              bg-white
              shadow-2xl
            "
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >

            {/* =================================================
                MODAL HEADER
            ================================================= */}

            <div
              className="
                flex
                items-center
                justify-between
                border-b border-slate-100
                px-6 py-5
              "
            >

              <div>

                <h2
                  className="
                    text-lg
                    font-extrabold
                    text-slate-900
                  "
                >
                  {editingEmployee
                    ? "Edit Employee"
                    : "Add Employee"}
                </h2>

                <p
                  className="
                    mt-1
                    text-xs
                    text-slate-400
                  "
                >
                  {editingEmployee
                    ? "Update employee information"
                    : "Create a new employee account assignment"}
                </p>

              </div>


              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="
                  flex h-9 w-9
                  items-center justify-center
                  rounded-lg
                  text-lg
                  text-slate-400
                  transition
                  hover:bg-slate-100
                  hover:text-slate-700
                  disabled:opacity-40
                "
              >
                ×
              </button>

            </div>


            {/* =================================================
                FORM
            ================================================= */}

            <form
              onSubmit={handleSubmit}
            >

              <div
                className="
                  max-h-[70vh]
                  space-y-5
                  overflow-y-auto
                  px-6 py-6
                "
              >

                {/* Form Error */}

                {formError && (

                  <div
                    className="
                      flex
                      items-start
                      gap-3
                      rounded-xl
                      border border-red-200
                      bg-red-50
                      p-3.5
                      text-sm
                      text-red-700
                    "
                  >

                    <span
                      className="
                        flex h-6 w-6
                        shrink-0
                        items-center justify-center
                        rounded-full
                        bg-red-100
                        text-xs font-bold
                      "
                    >
                      !
                    </span>

                    <span>
                      {formError}
                    </span>

                  </div>

                )}


                {/* Employee Code */}

                <FormField
                  label="Employee Code"
                  required
                >
                  <input
                    type="text"
                    value={
                      form.employee_code
                    }
                    onChange={(event) =>
                      handleChange(
                        "employee_code",
                        event.target.value
                      )
                    }
                    placeholder="EMP001"
                    required
                    disabled={saving}
                    className={inputClassName}
                  />
                </FormField>


                {/* Full Name */}

                <FormField
                  label="Full Name"
                  required
                >
                  <input
                    type="text"
                    value={
                      form.full_name
                    }
                    onChange={(event) =>
                      handleChange(
                        "full_name",
                        event.target.value
                      )
                    }
                    placeholder="Nguyen Van A"
                    required
                    disabled={saving}
                    className={inputClassName}
                  />
                </FormField>


                {/* Email */}

                <FormField
                  label="Email"
                  required
                >
                  <input
                    type="email"
                    value={
                      form.email
                    }
                    onChange={(event) =>
                      handleChange(
                        "email",
                        event.target.value
                      )
                    }
                    placeholder="employee@gmail.com"
                    required
                    disabled={saving}
                    className={inputClassName}
                  />
                </FormField>


                {/* Department */}

                <FormField
                  label="Department"
                >
                  <input
                    type="text"
                    value={
                      form.department
                    }
                    onChange={(event) =>
                      handleChange(
                        "department",
                        event.target.value
                      )
                    }
                    placeholder="IT"
                    disabled={saving}
                    className={inputClassName}
                  />
                </FormField>


                {/* User ID - CREATE ONLY */}

                {!editingEmployee && (

                  <FormField
                    label="User ID"
                    required
                  >

                    <input
                      type="number"
                      min="1"
                      value={
                        form.user_id
                      }
                      onChange={(event) =>
                        handleChange(
                          "user_id",
                          event.target.value
                        )
                      }
                      placeholder="2"
                      required
                      disabled={saving}
                      className={inputClassName}
                    />

                    <p
                      className="
                        mt-1.5
                        text-[11px]
                        leading-5
                        text-slate-400
                      "
                    >
                      Enter the existing user ID
                      that should be associated
                      with this employee.
                    </p>

                  </FormField>

                )}

              </div>


              {/* =================================================
                  FOOTER
              ================================================= */}

              <div
                className="
                  flex
                  justify-end
                  gap-3
                  border-t border-slate-100
                  bg-slate-50/50
                  px-6 py-4
                "
              >

                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="
                    rounded-xl
                    border border-slate-200
                    bg-white
                    px-5 py-2.5
                    text-sm font-semibold
                    text-slate-600
                    transition

                    hover:bg-slate-50

                    disabled:cursor-not-allowed
                    disabled:opacity-50
                  "
                >
                  Cancel
                </button>


                <button
                  type="submit"
                  disabled={saving}
                  className="
                    inline-flex
                    min-w-[130px]
                    items-center
                    justify-center
                    gap-2
                    rounded-xl
                    bg-blue-600
                    px-5 py-2.5
                    text-sm font-bold
                    text-white
                    transition

                    hover:bg-blue-700

                    focus:outline-none
                    focus:ring-4
                    focus:ring-blue-100

                    disabled:cursor-not-allowed
                    disabled:opacity-60
                  "
                >

                  {saving && (
                    <span
                      className="
                        h-4 w-4
                        animate-spin
                        rounded-full
                        border-2
                        border-white/40
                        border-t-white
                      "
                    />
                  )}

                  {saving
                    ? "Saving..."
                    : editingEmployee
                      ? "Save Changes"
                      : "Create Employee"}

                </button>

              </div>

            </form>

          </div>

        </div>

      )}

    </div>
  );
}


/* ============================================================
   FORM FIELD
============================================================ */

function FormField({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>

      <label
        className="
          mb-2
          block
          text-xs
          font-bold
          text-slate-700
        "
      >

        {label}

        {required && (
          <span className="ml-1 text-red-500">
            *
          </span>
        )}

      </label>

      {children}

    </div>
  );
}


/* ============================================================
   INPUT STYLE
============================================================ */

const inputClassName = `
  w-full
  rounded-xl
  border border-slate-200
  bg-white
  px-4 py-3
  text-sm
  text-slate-800
  outline-none
  transition

  placeholder:text-slate-400

  focus:border-blue-400
  focus:ring-4
  focus:ring-blue-50

  disabled:cursor-not-allowed
  disabled:bg-slate-50
  disabled:text-slate-400
`;


/* ============================================================
   INITIALS
============================================================ */

function getInitials(
  name: string
) {
  return name
    .trim()
    .split(/\s+/)
    .map(
      (part) => part[0]
    )
    .join("")
    .slice(-2)
    .toUpperCase();
}
