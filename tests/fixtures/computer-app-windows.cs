using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class ComputerFixture
{
    [DllImport("user32.dll")]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder value, int size, out int length);

    [DllImport("user32.dll")]
    private static extern bool CloseDesktop(IntPtr handle);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern uint GetMessagePos();

    [StructLayout(LayoutKind.Sequential)]
    private struct WindowRect { public int Left, Top, Right, Bottom; }

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out WindowRect value, int size);

    private static bool HasInteractiveDesktop(int session)
    {
        if (session == 0) return false;
        const uint desktopReadObjects = 1;
        const int objectName = 2;
        IntPtr desktop = OpenInputDesktop(0, false, desktopReadObjects);
        if (desktop == IntPtr.Zero) return false;
        try {
            int length;
            var name = new StringBuilder(256);
            return GetUserObjectInformation(desktop, objectName, name, name.Capacity * 2, out length)
                && name.ToString().Equals("Default", StringComparison.OrdinalIgnoreCase);
        } finally { CloseDesktop(desktop); }
    }

    private static object Position(Point point) { return new { x = point.X, y = point.Y }; }

    private static Point MouseMessagePosition()
    {
        uint packed = GetMessagePos();
        return new Point(unchecked((short)packed), unchecked((short)(packed >> 16)));
    }

    private static object Geometry(Rectangle rect)
    {
        return new { x = rect.X, y = rect.Y, width = rect.Width, height = rect.Height };
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Process process = Process.GetCurrentProcess();
        if (!HasInteractiveDesktop(process.SessionId)) {
            Console.Error.WriteLine("Requires an unlocked interactive Windows desktop. Session {0}.", process.SessionId);
            return 2;
        }

        Console.OutputEncoding = new UTF8Encoding(false);
        SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var workArea = Screen.PrimaryScreen.WorkingArea;
        var target = new Form { Text = args[0] + " Target", StartPosition = FormStartPosition.Manual,
            Location = new Point(workArea.Left + 12, workArea.Top + 12), ClientSize = new Size(400, 300) };
        var guard = new Form { Text = args[0] + " Guard", StartPosition = FormStartPosition.Manual,
            Location = new Point(target.Right - 50, target.Top), ClientSize = new Size(220, 120) };
        var button = new Button { Text = "Increment fixture", Bounds = new Rectangle(18, 18, 160, 38) };
        var field = new TextBox { AccessibleName = "Fixture Unicode text", Bounds = new Rectangle(18, 65, 350, 28) };
        var list = new ListBox { AccessibleName = "Fixture scrolling list", Bounds = new Rectangle(18, 105, 160, 170) };
        for (int i = 0; i < 100; i++) list.Items.Add("Fixture row " + i);
        var canvas = new Panel { Bounds = new Rectangle(200, 105, 172, 165), BackColor = Color.Navy };
        var square = new Panel { Bounds = new Rectangle(18, 20, 40, 40), BackColor = Color.Gold };
        var guardButton = new Button { Text = "Guard counter", Dock = DockStyle.Fill };
        target.Controls.AddRange(new Control[] { button, field, list, canvas });
        guard.Controls.Add(guardButton);
        canvas.Controls.Add(square);

        int count = 0, guardCount = 0;
        button.Click += delegate { count++; };
        guardButton.Click += delegate { guardCount++; };
        int holdPresses = 0, holdReleases = 0;
        long pressedAt = 0;
        double heldMilliseconds = 0;
        string heldButton = "";
        canvas.MouseDown += delegate(object sender, MouseEventArgs e) {
            holdPresses++;
            pressedAt = Stopwatch.GetTimestamp();
            heldButton = e.Button.ToString();
        };
        canvas.MouseUp += delegate {
            holdReleases++;
            heldMilliseconds = (Stopwatch.GetTimestamp() - pressedAt) * 1000.0 / Stopwatch.Frequency;
        };
        int dragPresses = 0, dragMoves = 0, dragReleases = 0;
        Point dragOrigin = Point.Empty;
        Point start = Point.Empty;
        square.MouseDown += delegate(object sender, MouseEventArgs e) {
            if (e.Button != MouseButtons.Left) return;
            dragPresses++;
            start = square.Location;
            dragOrigin = MouseMessagePosition();
            square.Capture = true;
        };
        square.MouseMove += delegate(object sender, MouseEventArgs e) {
            if (!square.Capture || e.Button != MouseButtons.Left) return;
            dragMoves++;
            Point cursor = MouseMessagePosition();
            square.Location = new Point(start.X + cursor.X - dragOrigin.X, start.Y + cursor.Y - dragOrigin.Y);
        };
        square.MouseUp += delegate { dragReleases++; square.Capture = false; };

        var json = new JavaScriptSerializer();
        using (var timer = new Timer { Interval = 75 }) {
            timer.Tick += delegate {
                IntPtr foreground = GetForegroundWindow();
                WindowRect visible;
                const int extendedFrameBounds = 9;
                bool hasVisibleBounds = DwmGetWindowAttribute(target.Handle, extendedFrameBounds, out visible,
                    Marshal.SizeOf(typeof(WindowRect))) == 0;
                Console.WriteLine(json.Serialize(new {
                    session = process.SessionId,
                    count, guardCount, fieldFocused = field.Focused, text = field.Text,
                    foreground = foreground == target.Handle ? "target" : foreground == guard.Handle ? "guard" : "other",
                    pointer = Position(Cursor.Position), frame = Geometry(target.Bounds),
                    visibleFrame = hasVisibleBounds ? Geometry(Rectangle.FromLTRB(visible.Left, visible.Top, visible.Right, visible.Bottom)) : null,
                    button = Geometry(button.RectangleToScreen(button.ClientRectangle)),
                    square = Geometry(square.RectangleToScreen(square.ClientRectangle)), squarePosition = Position(square.Location),
                    topRow = list.TopIndex, dragPresses, dragMoves, dragReleases,
                    canvas = Geometry(canvas.RectangleToScreen(canvas.ClientRectangle)),
                    holdPresses, holdReleases, heldButton, heldMilliseconds
                }));
            };
            target.Shown += delegate {
                guard.Show();
                guard.Activate();
                timer.Start();
            };
            Application.Run(target);
        }
        guard.Dispose();
        return 0;
    }
}
